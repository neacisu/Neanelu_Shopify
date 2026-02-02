import { describe, it, after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueuePro } from '@taskforcesh/bullmq-pro';

const tokenLifecyclePath = new URL('../../../auth/token-lifecycle.js', import.meta.url).href;
const shopifyClientPath = new URL('../../../shopify/client.js', import.meta.url).href;

const MOCK_SHOPIFY_OPERATION_ID = 'gid://shopify/BulkOperation/123';
const MOCK_RESULT_URL = 'https://shopify.example/bulk/result.jsonl';
const MOCK_PARTIAL_URL = 'https://shopify.example/bulk/partial.jsonl';
const MOCK_SHOP_DOMAIN = 'test-poller-store.myshopify.com';

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
                // The poller uses node(id: $id).
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
                      status: 'COMPLETED',
                      errorCode: null,
                      createdAt: new Date(Date.now() - 60_000).toISOString(),
                      completedAt: new Date().toISOString(),
                      objectCount: '10',
                      rootObjectCount: '7',
                      fileSize: '1234',
                      url: MOCK_RESULT_URL,
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

void describe('smoke: bulk poller (enqueue → poll → bulk_runs completed + artifact)', () => {
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
         VALUES ($1, 'PRODUCTS_EXPORT', 'core', 'running', $2, 0, 3, now(), now())
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

  void it('marks run completed and writes result URL artifact', async (t) => {
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

    // Wait up to ~5s for poller completion updates.
    let status: string | null = null;
    let resultUrl: string | null = null;
    let partialDataUrl: string | null = null;
    let cursorPartial: string | null = null;
    let shopifyObjectCount: number | null = null;
    let shopifyRootObjectCount: number | null = null;
    for (let i = 0; i < 50; i++) {
      const row = await withTenantContext(shopId, async (client) => {
        const res = await client.query<{
          status: string;
          result_url: string | null;
          partial_data_url: string | null;
          cursor_partial: string | null;
          shopify_object_count: number | null;
          shopify_root_object_count: number | null;
        }>(
          `SELECT
             status,
             result_url,
             partial_data_url,
             cursor_state ->> 'partialDataUrl' AS cursor_partial,
             shopify_object_count,
             shopify_root_object_count
           FROM bulk_runs
           WHERE id = $1`,
          [bulkRunId]
        );
        return res.rows[0] ?? null;
      });

      status = row?.status ?? null;
      resultUrl = row?.result_url ?? null;
      partialDataUrl = row?.partial_data_url ?? null;
      cursorPartial = row?.cursor_partial ?? null;
      shopifyObjectCount = row?.shopify_object_count ?? null;
      shopifyRootObjectCount = row?.shopify_root_object_count ?? null;
      if (resultUrl && partialDataUrl && cursorPartial) break;
      await sleep(100);
    }

    assert.ok(status && status !== 'failed');
    assert.equal(resultUrl, MOCK_RESULT_URL);
    assert.equal(partialDataUrl, MOCK_PARTIAL_URL);
    assert.equal(cursorPartial, MOCK_PARTIAL_URL);
    // PostgreSQL may return numeric columns as strings; coerce for comparison
    assert.equal(Number(shopifyObjectCount), 10);
    assert.equal(Number(shopifyRootObjectCount), 7);

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

    assert.equal(artifact?.url, MOCK_RESULT_URL);

    const partial = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ url: string }>(
        `SELECT url
         FROM bulk_artifacts
         WHERE bulk_run_id = $1
           AND shop_id = $2
           AND artifact_type = 'shopify_bulk_partial_url'
         LIMIT 1`,
        [bulkRunId, shopId]
      );
      return res.rows[0] ?? null;
    });

    assert.equal(partial?.url, MOCK_PARTIAL_URL);
  });
});
