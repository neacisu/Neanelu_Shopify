import { describe, it, after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueuePro } from '@taskforcesh/bullmq-pro';

const tokenLifecyclePath = new URL('../../../auth/token-lifecycle.js', import.meta.url).href;
const shopifyClientPath = new URL('../../../shopify/client.js', import.meta.url).href;

const MOCK_SHOPIFY_OPERATION_ID = 'gid://shopify/BulkOperation/999';
const MOCK_PARTIAL_URL = 'https://shopify.example/bulk/partial-only.jsonl';
const MOCK_SHOP_DOMAIN = 'test-poller-salvage.myshopify.com';

await (async () => {
  await Promise.resolve(
    mock.module(tokenLifecyclePath, {
      namedExports: {
        withTokenRetry: async <T>(
          _shopId: string,
          _encryptionKey: Buffer,
          _logger: unknown,
          fn: (accessToken: string, shopDomain: string) => Promise<T>
        ): Promise<T> => {
          return fn('shpat_test_token', MOCK_SHOP_DOMAIN);
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(shopifyClientPath, {
      namedExports: {
        shopifyApi: {
          createClient: (_options: unknown) => {
            return {
              request: (query: string, variables?: Record<string, unknown>) => {
                if (!query.includes('query BulkOperationNode')) {
                  throw new Error('unexpected_query');
                }
                if (variables?.['id'] !== MOCK_SHOPIFY_OPERATION_ID) {
                  throw new Error('unexpected_operation_id');
                }
                return {
                  data: {
                    node: {
                      __typename: 'BulkOperation',
                      id: MOCK_SHOPIFY_OPERATION_ID,
                      status: 'FAILED',
                      // Keep it transient (will retry), but retries are exhausted.
                      errorCode: 'TIMEOUT',
                      createdAt: new Date(Date.now() - 60_000).toISOString(),
                      completedAt: new Date().toISOString(),
                      objectCount: '10',
                      fileSize: '1234',
                      url: null,
                      partialDataUrl: MOCK_PARTIAL_URL,
                    },
                  },
                  extensions: {
                    cost: {
                      actualQueryCost: 10,
                      requestedQueryCost: 10,
                      throttleStatus: {
                        currentlyAvailable: 1000,
                        maximumAvailable: 1000,
                        restoreRate: 50,
                      },
                    },
                  },
                };
              },
            };
          },
        },
      },
    })
  );
})();

function isCiIntegrationEnvPresent(): boolean {
  if ((process.env['SMOKE_RUN'] ?? '').trim() !== '1') return false;

  const required = [
    'APP_HOST',
    'DATABASE_URL',
    'REDIS_URL',
    'BULLMQ_PRO_TOKEN',
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SCOPES',
    'ENCRYPTION_KEY_VERSION',
    'ENCRYPTION_KEY_256',
    'OTEL_SERVICE_NAME',
  ];

  return required.every((k) => Boolean(process.env[k]?.trim()));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

void describe('smoke: bulk poller (terminal failure + partialDataUrl + retries exhausted → salvage)', () => {
  let shopId: string;
  let bulkRunId: string;
  let close: (() => Promise<void>) | null = null;
  let pollerQueue: QueuePro | null = null;
  let pollerDlqQueue: QueuePro | null = null;

  before(async () => {
    shopId = randomUUID();

    if (!isCiIntegrationEnvPresent()) return;

    const { pool } = await import('@app/database');

    await pool.query(
      `INSERT INTO shops (
         id,
         shopify_domain,
         access_token_ciphertext,
         access_token_iv,
         access_token_tag,
         key_version,
         scopes
       )
       VALUES ($1, $2, $3, $4, $5, 1, ARRAY['read_products']::text[])
       ON CONFLICT (id) DO NOTHING`,
      [shopId, MOCK_SHOP_DOMAIN, 'AA==', 'AA==', 'AA==']
    );

    const { withTenantContext } = await import('@app/database');
    bulkRunId = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO bulk_runs (
           shop_id,
           operation_type,
           query_type,
           status,
           shopify_operation_id,
           retry_count,
           max_retries,
           created_at,
           updated_at
         )
         VALUES ($1, 'PRODUCTS_EXPORT', 'core', 'running', $2, 3, 3, now(), now())
         RETURNING id`,
        [shopId, MOCK_SHOPIFY_OPERATION_ID]
      );
      return res.rows[0]?.id ?? '';
    });

    assert.ok(bulkRunId);

    const { QueuePro } = await import('@taskforcesh/bullmq-pro');

    pollerQueue = new QueuePro('bulk-poller-queue', {
      connection: {
        url: process.env['REDIS_URL'] ?? '',
        enableReadyCheck: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: null,
      },
    });
    pollerDlqQueue = new QueuePro('bulk-poller-queue-dlq', {
      connection: {
        url: process.env['REDIS_URL'] ?? '',
        enableReadyCheck: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: null,
      },
    });

    await pollerQueue.obliterate({ force: true });
    await pollerDlqQueue.obliterate({ force: true });

    const { startBulkPollerWorker } = await import('../poller.worker.js');
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };

    const handle = startBulkPollerWorker(logger as never);
    close = async () => {
      await handle.close();
      const { closeBulkQueue } = await import('@app/queue-manager');
      await closeBulkQueue();
      if (pollerQueue) {
        await pollerQueue.close();
        pollerQueue = null;
      }
      if (pollerDlqQueue) {
        await pollerDlqQueue.close();
        pollerDlqQueue = null;
      }
    };
  });

  after(async () => {
    if (!isCiIntegrationEnvPresent()) return;

    try {
      if (close) await close();
    } finally {
      const { pool, withTenantContext, closePool } = await import('@app/database');

      await withTenantContext(shopId, async (client) => {
        await client.query(`DELETE FROM bulk_runs WHERE shop_id = $1`, [shopId]);
      });

      await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId]);

      if (process.env['SMOKE_RUN'] === '1') {
        await closePool();
      }
    }
  });

  void it('marks run completed with partial result url and does not DLQ', async (t) => {
    if (!isCiIntegrationEnvPresent()) {
      t.skip('Requires DATABASE_URL/REDIS_URL/BULLMQ_PRO_TOKEN and other CI env vars');
      return;
    }

    const { enqueueBulkPollerJob } = await import('@app/queue-manager');
    await enqueueBulkPollerJob({
      shopId,
      bulkRunId,
      shopifyOperationId: MOCK_SHOPIFY_OPERATION_ID,
      triggeredBy: 'manual',
      requestedAt: Date.now(),
    });

    const { withTenantContext } = await import('@app/database');

    let status: string | null = null;
    let resultUrl: string | null = null;
    let partialDataUrl: string | null = null;
    let resultSource: string | null = null;

    for (let i = 0; i < 50; i++) {
      const row = await withTenantContext(shopId, async (client) => {
        const res = await client.query<{
          status: string;
          result_url: string | null;
          partial_data_url: string | null;
          result_source: string | null;
        }>(
          `SELECT
             status,
             result_url,
             partial_data_url,
             cursor_state #>> '{result,source}' AS result_source
           FROM bulk_runs
           WHERE id = $1`,
          [bulkRunId]
        );
        return res.rows[0] ?? null;
      });

      status = row?.status ?? null;
      resultUrl = row?.result_url ?? null;
      partialDataUrl = row?.partial_data_url ?? null;
      resultSource = row?.result_source ?? null;
      if (status === 'completed') break;
      await sleep(100);
    }

    assert.equal(status, 'completed');
    assert.equal(resultUrl, MOCK_PARTIAL_URL);
    assert.equal(partialDataUrl, MOCK_PARTIAL_URL);
    assert.equal(resultSource, 'partialDataUrl');

    const artifact = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ url: string }>(
        `SELECT url
         FROM bulk_artifacts
         WHERE bulk_run_id = $1
           AND shop_id = $2
           AND artifact_type = 'shopify_bulk_result_url'
         LIMIT 1`,
        [bulkRunId, shopId]
      );
      return res.rows[0] ?? null;
    });

    assert.equal(artifact?.url, MOCK_PARTIAL_URL);

    // DLQ should remain empty.
    const dlqCount = await pollerDlqQueue?.getJobCountByTypes('waiting', 'delayed', 'failed');
    assert.equal(dlqCount ?? 0, 0);
  });
});
