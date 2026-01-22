import { describe, it, after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueuePro } from '@taskforcesh/bullmq-pro';
import { Redis as IORedis } from 'ioredis';
import { acquireBulkLock, enqueueBulkOrchestratorJob, releaseBulkLock } from '@app/queue-manager';

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
  // Smoke tests are intended to run via `pnpm smoke` (see scripts/smoke-runner.ts).
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

async function cleanupBulkRuns(shopId: string): Promise<void> {
  const { withTenantContext } = await import('@app/database');
  await withTenantContext(shopId, async (client) => {
    await client.query(`DELETE FROM bulk_runs WHERE shop_id = $1`, [shopId]);
  });

  // Clear distributed GraphQL rate limiter state for determinism.
  // Without this, a previous run can leave low tokens and delay the orchestrator.
  const redis = new IORedis(process.env['REDIS_URL'] ?? '');
  try {
    await redis.del(`neanelu:ratelimit:graphql:${shopId}`);
    await redis.del(`bulk-lock:${shopId.trim().toLowerCase()}`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

void describe('smoke: bulk orchestrator (enqueue → DB → poller scheduled)', () => {
  let shopId: string;
  let close: (() => Promise<void>) | null = null;
  let bulkQueue: QueuePro | null = null;
  let bulkDlqQueue: QueuePro | null = null;
  let pollerQueue: QueuePro | null = null;

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

    const { QueuePro } = await import('@taskforcesh/bullmq-pro');

    bulkQueue = new QueuePro('bulk-queue', {
      connection: {
        url: process.env['REDIS_URL'] ?? '',
        enableReadyCheck: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: null,
      },
    });

    bulkDlqQueue = new QueuePro('bulk-queue-dlq', {
      connection: {
        url: process.env['REDIS_URL'] ?? '',
        enableReadyCheck: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: null,
      },
    });

    pollerQueue = new QueuePro('bulk-poller-queue', {
      connection: {
        url: process.env['REDIS_URL'] ?? '',
        enableReadyCheck: true,
        connectTimeout: 10_000,
        maxRetriesPerRequest: null,
      },
    });

    // Smoke runs should be deterministic. If Redis is shared between runs (local dev),
    // stale jobs can keep retrying and/or end up in DLQ, stealing worker time.
    await bulkQueue.obliterate({ force: true });
    await bulkDlqQueue.obliterate({ force: true });
    await pollerQueue.obliterate({ force: true });

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
      if (bulkQueue) {
        await bulkQueue.close();
        bulkQueue = null;
      }
      if (bulkDlqQueue) {
        await bulkDlqQueue.close();
        bulkDlqQueue = null;
      }
      if (pollerQueue) {
        await pollerQueue.close();
        pollerQueue = null;
      }
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

    const { withTenantContext } = await import('@app/database');

    const pollerQ = pollerQueue;
    assert.ok(pollerQ, 'poller queue should be initialized');

    await cleanupBulkRuns(shopId);

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
          id: string;
          status: string;
          shopify_operation_id: string | null;
          error_message: string | null;
        }>(
          `SELECT id, status, shopify_operation_id
                  , error_message
           FROM bulk_runs
           WHERE shop_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [shopId]
        );
        return res.rows[0] ?? null;
      });

      if (row?.status === 'failed') {
        assert.fail(`Bulk orchestrator marked run failed: ${row.error_message ?? 'unknown'}`);
      }

      if (row?.status === 'running' && row.shopify_operation_id === MOCK_SHOPIFY_OPERATION_ID) {
        assert.equal(row.shopify_operation_id, MOCK_SHOPIFY_OPERATION_ID);

        const pollerJob = await pollerQ.getJob(`bulk-poller__${row.id}`);
        assert.ok(pollerJob, 'poller job should be enqueued');
        await pollerJob.remove().catch(() => undefined);
        return;
      }

      await sleep(200);
    }

    assert.fail('Timed out waiting for bulk orchestrator to persist a running bulk_runs row');
  });

  void it('delays the job when the bulk lock is held (no DB writes)', async (t) => {
    if (!isCiIntegrationEnvPresent()) {
      t.skip('Requires DATABASE_URL/REDIS_URL/BULLMQ_PRO_TOKEN and other CI env vars');
      return;
    }

    const bulkQ = bulkQueue;
    assert.ok(bulkQ, 'bulk queue should be initialized');

    const pollerQ = pollerQueue;
    assert.ok(pollerQ, 'poller queue should be initialized');

    const { withTenantContext, pool } = await import('@app/database');

    // Use a separate shopId/group so group-level rate limiting from contention
    // doesn't block later tests for the main shop.
    const contentionShopId = randomUUID();

    // Minimal shop row (required by bulk_runs FK).
    const contentionDomain = `test-store-${contentionShopId.slice(0, 8)}.myshopify.com`;

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
      [contentionShopId, contentionDomain, 'AA==', 'AA==', 'AA==']
    );

    await cleanupBulkRuns(contentionShopId);

    const redis = new IORedis(process.env['REDIS_URL'] ?? '');
    let lockToken: Readonly<{ shopId: string; token: string }> | null = null;
    lockToken = await acquireBulkLock(redis, contentionShopId, { ttlMs: 30_000 });
    if (!lockToken) throw new Error('expected to acquire bulk lock for contention test');

    const idempotencyKey = `lock-test-${randomUUID()}`;
    const jobId = `bulk-orchestrator__${contentionShopId}__${idempotencyKey}`;

    try {
      await enqueueBulkOrchestratorJob({
        shopId: contentionShopId,
        operationType: 'PRODUCTS_EXPORT',
        queryType: 'smoke-lock',
        graphqlQuery: `query { products(first: 1) { edges { node { id } } } }`,
        idempotencyKey,
        triggeredBy: 'system',
        requestedAt: Date.now(),
      });

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const job = await bulkQ.getJob(jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'delayed') {
            const delayMs = Number((job as { delay?: number }).delay ?? job.opts?.delay ?? 0);
            if (delayMs > 0) {
              assert.ok(delayMs >= 59_000, `expected delay >= 59000ms, got ${delayMs}`);
            } else {
              await sleep(500);
              const stillDelayed = await job.getState();
              assert.equal(stillDelayed, 'delayed');
            }
            const persistedCount = await withTenantContext(contentionShopId, async (client) => {
              const res = await client.query<{ c: string }>(
                `SELECT COUNT(*)::text AS c
                 FROM bulk_runs
                 WHERE shop_id = $1 AND idempotency_key = $2`,
                [contentionShopId, idempotencyKey]
              );
              return Number(res.rows[0]?.c ?? '0');
            });

            assert.equal(persistedCount, 0, 'orchestrator should not write DB while lock is held');
            await job.remove().catch(() => undefined);
            return;
          }
        }
        await sleep(150);
      }

      assert.fail('Timed out waiting for contended job to move to delayed state');
    } finally {
      let released = false;
      if (lockToken) {
        released = await releaseBulkLock(redis, lockToken).catch(() => false);
      }
      assert.equal(released, true, 'expected to release bulk lock after contention test');
      await redis.quit().catch(() => undefined);
      await cleanupBulkRuns(contentionShopId).catch(() => undefined);
      await pool
        .query(`DELETE FROM shops WHERE id = $1`, [contentionShopId])
        .catch(() => undefined);
    }
  });

  void it('is idempotent: re-enqueues poller if run already has shopify_operation_id', async (t) => {
    if (!isCiIntegrationEnvPresent()) {
      t.skip('Requires DATABASE_URL/REDIS_URL/BULLMQ_PRO_TOKEN and other CI env vars');
      return;
    }

    const bulkQ = bulkQueue;
    assert.ok(bulkQ, 'bulk queue should be initialized');

    const pollerQ = pollerQueue;
    assert.ok(pollerQ, 'poller queue should be initialized');

    const { withTenantContext } = await import('@app/database');
    await cleanupBulkRuns(shopId);

    const idempotencyKey = `resume-test-${randomUUID()}`;
    const orchestratorJobId = `bulk-orchestrator__${shopId}__${idempotencyKey}`;

    const runId = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO bulk_runs (
           shop_id,
           operation_type,
           query_type,
           status,
           idempotency_key,
           shopify_operation_id,
           created_at,
           updated_at
         )
         VALUES ($1, 'PRODUCTS_EXPORT', 'smoke-resume', 'running', $2, $3, now(), now())
         RETURNING id`,
        [shopId, idempotencyKey, MOCK_SHOPIFY_OPERATION_ID]
      );
      const row = res.rows[0];
      assert.ok(row?.id);
      return row.id;
    });

    await enqueueBulkOrchestratorJob({
      shopId,
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'smoke-resume',
      graphqlQuery: `query { products(first: 1) { edges { node { id } } } }`,
      idempotencyKey,
      triggeredBy: 'system',
      requestedAt: Date.now(),
    });

    // Wait for the orchestrator job to settle, then verify the poller job was scheduled.
    const deadline = Date.now() + 10_000;
    let lastOrchestratorState: string | null = null;
    while (Date.now() < deadline) {
      const orchJob = await bulkQ.getJob(orchestratorJobId);
      if (orchJob) {
        const state = await orchJob.getState();
        lastOrchestratorState = state;
        if (state === 'failed' || state === 'delayed') {
          const reason = (orchJob.failedReason ?? null) as string | null;
          assert.fail(
            `Orchestrator job entered state=${state}${reason ? ` reason=${reason}` : ''}`
          );
        }

        if (state === 'completed') break;
      }

      await sleep(150);
    }

    if (lastOrchestratorState !== 'completed') {
      const counts = await bulkQ.getJobCounts('wait', 'delayed', 'active', 'completed', 'failed');
      assert.fail(
        `Orchestrator job did not complete in time (jobId=${orchestratorJobId} lastState=${lastOrchestratorState ?? 'missing'}) ` +
          `counts=${JSON.stringify(counts)}`
      );
    }

    const rows = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ id: string; shopify_operation_id: string | null }>(
        `SELECT id, shopify_operation_id
         FROM bulk_runs
         WHERE shop_id = $1 AND idempotency_key = $2
         ORDER BY created_at DESC`,
        [shopId, idempotencyKey]
      );
      return res.rows;
    });

    assert.equal(
      rows.length,
      1,
      'should not create additional bulk_runs rows for same idempotency'
    );
    assert.equal(rows[0]?.id, runId, 'should reuse the existing bulk_run row');
    assert.equal(
      rows[0]?.shopify_operation_id,
      MOCK_SHOPIFY_OPERATION_ID,
      'run should retain the existing shopify_operation_id'
    );

    const pollerJob = await pollerQ.getJob(`bulk-poller__${runId}`);
    if (!pollerJob) {
      const counts = await pollerQ.getJobCounts('wait', 'delayed', 'active', 'completed', 'failed');
      const sample = await pollerQ.getJobs(
        ['wait', 'delayed', 'active', 'completed', 'failed'],
        0,
        10
      );
      const sampleSummary = sample.map((j) => ({ id: j.id, name: j.name }));
      assert.fail(
        `poller job should be enqueued on idempotent resume (expected jobId=bulk-poller__${runId}) ` +
          `counts=${JSON.stringify(counts)} sample=${JSON.stringify(sampleSummary)}`
      );
    }
    await pollerJob.remove().catch(() => undefined);
  });
});
