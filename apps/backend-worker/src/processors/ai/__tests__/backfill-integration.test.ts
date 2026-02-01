import { beforeEach, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const queueCalls: string[] = [];

await (async () => {
  const throttlePath = new URL('../throttle.js', import.meta.url).href;
  await Promise.resolve(
    mock.module(throttlePath, {
      namedExports: {
        checkBackfillThrottle: () => Promise.resolve({ allowed: true, delayMs: 0 }),
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/queue-manager', {
      namedExports: {
        configFromEnv: () => ({ redisUrl: 'redis://localhost:6379' }),
        createQueue: () => ({ add: () => Promise.resolve() }),
        enqueueDlqEntry: () => Promise.resolve(),
        enqueueAiBatchBackfillJob: () => {
          queueCalls.push('backfill');
          return Promise.resolve();
        },
        enqueueAiBatchPollerJob: () => {
          queueCalls.push('poller');
          return Promise.resolve();
        },
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/ai-engine', {
      namedExports: {
        OpenAiBatchManager: class {
          uploadJsonlFile(): Promise<{ id: string }> {
            return Promise.resolve({ id: 'file-123' });
          }
          createBatch(): Promise<{ id: string; expires_at: number | null }> {
            return Promise.resolve({ id: 'batch-123', expires_at: null });
          }
        },
        createEmbeddingsProvider: () => ({
          model: { name: 'text-embedding-3-large', dimensions: 2000 },
        }),
        sha256Hex: () => 'hash',
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/database', {
      namedExports: {
        decryptAesGcm: () => Buffer.from(''),
        encryptAesGcm: () => ({
          ciphertext: Buffer.from(''),
          iv: Buffer.from(''),
          tag: Buffer.from(''),
        }),
        getOptimalEfSearch: () => 40,
        setHnswEfSearch: () => Promise.resolve(),
        pool: {
          query: () => Promise.resolve({ rows: [] }),
        },
        withTenantContext: async (
          _shopId: string,
          fn: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
        ) => {
          const client = {
            query: (sql: string) => {
              if (sql.includes('FROM embedding_backfill_runs')) {
                return Promise.resolve({ rows: [] });
              }
              if (sql.includes('INSERT INTO embedding_backfill_runs')) {
                return Promise.resolve({
                  rows: [{ id: 'run-1', status: 'running', lastProductId: null }],
                });
              }
              if (sql.includes('FROM shopify_products')) {
                return Promise.resolve({
                  rows: [
                    {
                      id: '00000000-0000-0000-0000-000000000001',
                      title: 'Prod',
                      description: 'Desc',
                      descriptionHtml: null,
                      vendor: null,
                      productType: null,
                      tags: [],
                    },
                  ],
                });
              }
              if (sql.includes('FROM shop_product_embeddings')) {
                return Promise.resolve({ rows: [] });
              }
              if (sql.includes('INSERT INTO embedding_batches')) {
                return Promise.resolve({ rows: [{ id: 'embedding-batch-1' }] });
              }
              if (sql.includes('SELECT COALESCE(SUM(request_count)')) {
                return Promise.resolve({ rows: [{ used: 0 }] });
              }
              return Promise.resolve({ rows: [] });
            },
          };
          return await fn(client);
        },
      },
    })
  );
})();

const { runAiBatchBackfill } = await import('../backfill.js');

const BASE_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  APP_HOST: 'https://example.com',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  BULLMQ_PRO_TOKEN: 'token',
  SHOPIFY_API_KEY: 'shopify_key',
  SHOPIFY_API_SECRET: 'shopify_secret',
  SCOPES: 'read_products',
  ENCRYPTION_KEY_VERSION: '1',
  ENCRYPTION_KEY_256: 'a'.repeat(64),
  OTEL_SERVICE_NAME: 'neanelu-test',
  OPENAI_API_KEY: 'openai-key',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
  OPENAI_TIMEOUT_MS: '30000',
  OPENAI_BATCH_MAX_ITEMS: '1000',
  OPENAI_BATCH_POLL_SECONDS: '3600',
  OPENAI_BATCH_RETENTION_DAYS: '30',
  OPENAI_BATCH_SCHEDULE_TICK_SECONDS: '60',
  BULK_PIM_SYNC_ENABLED: 'true',
  BULK_SEMANTIC_DEDUP_ENABLED: 'true',
  BULK_CONSENSUS_ENABLED: 'true',
  BULK_DEDUPE_HIGH_THRESHOLD: '0.95',
  BULK_DEDUPE_SUSPICIOUS_THRESHOLD: '0.85',
  BULK_DEDUPE_NEEDS_REVIEW_THRESHOLD: '0.9',
  BULK_DEDUPE_MAX_RESULTS: '10',
  OPENAI_EMBEDDING_MAX_RETRIES: '3',
  OPENAI_EMBEDDING_BACKFILL_ENABLED: 'true',
  OPENAI_EMBEDDING_DAILY_BUDGET: '100000',
};

void describe('backfill integration', () => {
  const originalEnv = { ...process.env };
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };

  beforeEach(() => {
    queueCalls.length = 0;
    process.env = { ...originalEnv, ...BASE_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  void it('creates a batch and enqueues poller', async () => {
    await runAiBatchBackfill({
      payload: {
        shopId: '00000000-0000-0000-0000-000000000000',
        requestedAt: Date.now(),
        triggeredBy: 'system',
        chunkSize: 1,
      },
      logger,
    });

    assert.ok(queueCalls.includes('poller'));
    assert.ok(queueCalls.includes('backfill'));
  });
});
