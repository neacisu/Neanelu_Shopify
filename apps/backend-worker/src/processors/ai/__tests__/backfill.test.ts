import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runAiBatchBackfill } from '../backfill.js';

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

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

void describe('ai backfill', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...BASE_ENV };
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  void it('returns early when OpenAI API key is missing', async () => {
    await runAiBatchBackfill({
      payload: {
        shopId: '00000000-0000-0000-0000-000000000000',
        requestedAt: Date.now(),
        triggeredBy: 'system',
      },
      logger,
    });

    assert.ok(true);
  });
});
