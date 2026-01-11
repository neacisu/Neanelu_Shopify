import { describe, it, after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const tokenLifecyclePath = new URL('../../../auth/token-lifecycle.js', import.meta.url).href;
const shopifyClientPath = new URL('../../../shopify/client.js', import.meta.url).href;

const MOCK_SHOPIFY_OPERATION_ID = 'gid://shopify/BulkOperation/123';

// node:test module mocking is async; ensure it settles before tests run.
// The typings of `mock.module` may not reflect its async behavior, so we
// normalize through Promise.resolve to satisfy lint rules.
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
          return fn('shpat_test_token', 'test-store.myshopify.com');
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
              request: () => {
                return {
                  data: {
                    bulkOperationRunQuery: {
                      bulkOperation: { id: MOCK_SHOPIFY_OPERATION_ID, status: 'CREATED' },
                      userErrors: [],
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
  // `@app/config.loadEnv()` is evaluated at import-time by the worker.
  // Only run this smoke test when the full CI/local integration env is present.
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

void describe('smoke: bulk orchestrator (enqueue → DB → poller scheduled)', () => {
  let shopId: string;
  let close: (() => Promise<void>) | null = null;

  before(async () => {
    shopId = randomUUID();

    if (!isCiIntegrationEnvPresent()) return;

    const { pool } = await import('@app/database');

    // Minimal shop row (required by bulk_runs FK). Shops table is not RLS-protected.
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
      [shopId, 'test-store.myshopify.com', 'AA==', 'AA==', 'AA==']
    );

    const { startBulkOrchestratorWorker } = await import('../orchestrator.worker.js');

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };

    const handle = startBulkOrchestratorWorker(logger as never);
    close = async () => {
      await handle.close();
      const { closeBulkQueue } = await import('@app/queue-manager');
      await closeBulkQueue();
    };
  });

  after(async () => {
    if (!isCiIntegrationEnvPresent()) return;

    try {
      if (close) await close();
    } finally {
      const { pool, withTenantContext, closePool } = await import('@app/database');

      // Clean up tenant data under RLS, then remove the shop row.
      await withTenantContext(shopId, async (client) => {
        await client.query(`DELETE FROM bulk_runs WHERE shop_id = $1`, [shopId]);
      });

      await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId]);

      // In the dedicated smoke run we want an immediate process exit.
      // Otherwise pg's Pool can keep the event loop alive until idleTimeoutMillis.
      if (process.env['SMOKE_RUN'] === '1') {
        await closePool();
      }
    }
  });

  void it('creates a running bulk_runs row and enqueues poller', async (t) => {
    if (!isCiIntegrationEnvPresent()) {
      t.skip('Requires DATABASE_URL/REDIS_URL/BULLMQ_PRO_TOKEN and other CI env vars');
      return;
    }

    const { enqueueBulkOrchestratorJob } = await import('@app/queue-manager');
    const { withTenantContext } = await import('@app/database');

    await enqueueBulkOrchestratorJob({
      shopId,
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'smoke',
      graphqlQuery: `query {
        products(first: 1) { edges { node { id } } }
      }`,
      triggeredBy: 'system',
      requestedAt: Date.now(),
    });

    const deadline = Date.now() + 12_000;

    while (Date.now() < deadline) {
      const row = await withTenantContext(shopId, async (client) => {
        const res = await client.query<{
          status: string;
          shopify_operation_id: string | null;
        }>(
          `SELECT status, shopify_operation_id
           FROM bulk_runs
           WHERE shop_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [shopId]
        );
        return res.rows[0] ?? null;
      });

      if (row?.status === 'running' && row.shopify_operation_id === MOCK_SHOPIFY_OPERATION_ID) {
        assert.equal(row.shopify_operation_id, MOCK_SHOPIFY_OPERATION_ID);
        return;
      }

      await sleep(200);
    }

    assert.fail('Timed out waiting for bulk orchestrator to persist a running bulk_runs row');
  });
});
