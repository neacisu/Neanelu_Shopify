import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import type { AppEnv } from '@app/config';

const sessionPath = new URL('../../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    getSessionFromRequest: () => ({
      shopId: 'shop-1',
      shopDomain: 'test.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    createRedisConnection: () => ({
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      scan: () => Promise.resolve(['0', []]),
      pipeline: () => ({
        del: (_key: string) => undefined,
        exec: () => Promise.resolve([]),
      }),
      quit: () => Promise.resolve(undefined),
      on: () => undefined,
    }),
    configFromEnv: (env: { redisUrl?: string; bullmqProToken?: string }) => ({
      redisUrl: env.redisUrl ?? 'redis://localhost:6379',
      bullmqProToken: env.bullmqProToken ?? 'test-token',
    }),
    createQueue: () => ({
      add: () => Promise.resolve({ id: 'test-job' }),
      close: () => Promise.resolve(),
    }),
  },
});

void mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from(''),
    encryptAesGcm: () => ({
      ciphertext: Buffer.from(''),
      iv: Buffer.from(''),
      tag: Buffer.from(''),
    }),
    getOptimalEfSearch: () => 40,
    setHnswEfSearch: () => Promise.resolve(),
    withTenantContext: async (_shopId: string, fn: (client: unknown) => Promise<unknown>) => {
      return await fn({
        query: () => Promise.resolve({ rows: [{ count: 1 }] }),
      });
    },
  },
});

let rateLimitAllowed = true;
let rateLimitDelayMs = 0;
const rateLimitTokensRemaining = 100;
let budgetExceeded = false;

void mock.module('@app/ai-engine', {
  namedExports: {
    EmbeddingsDisabledError: class EmbeddingsDisabledError extends Error {},
    createEmbeddingsProvider: () => ({
      isAvailable: () => true,
      embedTexts: () => Promise.resolve([[0.1, 0.2, 0.3]]),
      model: { name: 'text-embedding-3-large', dimensions: 3 },
      kind: 'openai',
    }),
    gateOpenAiEmbeddingRequest: () =>
      Promise.resolve({
        allowed: rateLimitAllowed,
        delayMs: rateLimitDelayMs,
        tokensRemaining: rateLimitTokensRemaining,
      }),
  },
});

void mock.module('@app/pim', {
  namedExports: {
    checkBudget: () =>
      Promise.resolve({
        provider: 'openai',
        primary: { unit: 'dollars', used: 1, limit: 10, remaining: 9, ratio: 0.1 },
        alertThreshold: 0.8,
        exceeded: budgetExceeded,
        alertTriggered: false,
      }),
  },
});

const searchProcessorPath = new URL('../search.js', import.meta.url).href;
void mock.module(searchProcessorPath, {
  namedExports: {
    generateQueryEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    searchSimilarProducts: () =>
      Promise.resolve([
        {
          productId: 'prod-1',
          title: 'Test Product',
          similarity: 0.92,
          embeddingType: 'combined',
          qualityLevel: 'bronze',
        },
      ]),
  },
});

const cachePath = new URL('../cache.js', import.meta.url).href;
void mock.module(cachePath, {
  namedExports: {
    getCachedSearchResult: () => Promise.resolve(null),
    setCachedSearchResult: () => Promise.resolve(undefined),
  },
});

const { searchRoutes } = await import('../../../routes/search.js');

const env = {
  nodeEnv: 'test',
  logLevel: 'info',
  port: 65000,
  appHost: new URL('https://example.com'),
  databaseUrl: 'postgres://user:pass@localhost:5432/test',
  redisUrl: 'redis://localhost:6379',
  bullmqProToken: 'test-token',
  maxActivePerShop: 5,
  maxGlobalConcurrency: 50,
  starvationTimeoutMs: 60_000,
  maxConcurrentDownloads: 2,
  maxConcurrentCopies: 2,
  maxGlobalIngestion: 4,
  shopifyApiKey: 'test-api-key',
  shopifyApiSecret: 'test-api-secret',
  scopes: ['read_products'],
  encryptionKeyVersion: 1,
  encryptionKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  otelExporterOtlpEndpoint: 'http://localhost:4318',
  otelServiceName: 'backend-worker',
  bulkCopyBatchRows: 1000,
  bulkCopyBatchBytes: 5_000_000,
  bulkDownloadHighWaterMarkBytes: 512 * 1024,
  bulkMergeAnalyze: true,
  bulkMergeAllowDeletes: false,
  bulkStagingReindex: false,
  openAiApiKey: 'test',
  openAiBaseUrl: 'https://api.openai.com',
  openAiEmbeddingsModel: 'text-embedding-3-large',
  openAiTimeoutMs: 1000,
  openAiBatchMaxItems: 1000,
  openAiBatchPollSeconds: 3600,
  openAiBatchRetentionDays: 30,
  openAiBatchScheduleTickSeconds: 60,
  openAiEmbeddingMaxRetries: 3,
  openAiEmbeddingBackfillEnabled: true,
  openAiEmbeddingDailyBudget: 10_000,
  openAiEmbeddingCostPer1MTokens: 0.02,
  openAiEmbedRateLimitTokensPerMinute: 1_000_000,
  openAiEmbedRateLimitRequestsPerMinute: 3_000,
  openAiEmbedRateLimitBucketTtlMs: 120_000,
  openAiEmbedThrottleShopHourlyLimit: 4000,
  openAiEmbedThrottleShopDailyLimit: 20000,
  openAiEmbedThrottleGlobalHourlyLimit: 20000,
  openAiBatchMaxGlobal: 5,
  vectorSearchCacheTtlSeconds: 300,
  vectorSearchQueryTimeoutMs: 2_000,
  openAiEmbeddingDimensions: 2000,
  serperDailyBudget: 25,
  serperBudgetAlertThreshold: 0.8,
  serperHealthCheckIntervalSeconds: 3600,
  openAiHealthCheckIntervalSeconds: 3600,
  xaiHealthCheckIntervalSeconds: 3600,
  enrichmentWorkerConcurrency: 5,
  bulkPimSyncEnabled: true,
  bulkSemanticDedupEnabled: true,
  bulkConsensusEnabled: true,
  bulkExternalConsensusEnabled: true,
  bulkDedupeHighThreshold: 0.9,
  bulkDedupeNeedsReviewThreshold: 0.85,
  bulkDedupeMaxResults: 10,
  bulkDedupeSuspiciousThreshold: 0.7,
} as AppEnv;

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

void describe('search route integration', () => {
  void it('returns search results and caches', async () => {
    rateLimitAllowed = true;
    rateLimitDelayMs = 0;
    budgetExceeded = false;
    const app = Fastify();
    try {
      await app.register(searchRoutes, {
        prefix: '/api',
        env,
        logger,
        sessionConfig: { secret: 'test', maxAge: 3600, cookieName: 'neanelu_session' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/products/search?q=iphone+case',
      });

      assert.equal(response.statusCode, 200);
      const parsed: unknown = JSON.parse(response.body);
      assert.ok(parsed && typeof parsed === 'object');
      const body = parsed as { data?: { results?: unknown[]; cached?: boolean } };
      assert.equal(body.data?.cached, false);
      assert.equal(body.data?.results?.length, 1);
    } finally {
      await app.close();
    }
  });

  void it('returns 429 when rate limited', async () => {
    rateLimitAllowed = false;
    rateLimitDelayMs = 250;
    budgetExceeded = false;
    const app = Fastify();
    try {
      await app.register(searchRoutes, {
        prefix: '/api',
        env,
        logger,
        sessionConfig: { secret: 'test', maxAge: 3600, cookieName: 'neanelu_session' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/products/search?q=iphone+case',
      });

      assert.equal(response.statusCode, 429);
      const parsed: unknown = JSON.parse(response.body);
      assert.ok(parsed && typeof parsed === 'object');
      const body = parsed as { error?: { code?: string } };
      assert.equal(body.error?.code, 'TOO_MANY_REQUESTS');
    } finally {
      await app.close();
    }
  });

  void it('returns 429 when daily OpenAI budget is exceeded', async () => {
    rateLimitAllowed = true;
    rateLimitDelayMs = 0;
    budgetExceeded = true;
    const app = Fastify();
    try {
      await app.register(searchRoutes, {
        prefix: '/api',
        env,
        logger,
        sessionConfig: { secret: 'test', maxAge: 3600, cookieName: 'neanelu_session' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/products/search?q=iphone+case',
      });

      assert.equal(response.statusCode, 429);
      const parsed: unknown = JSON.parse(response.body);
      assert.ok(parsed && typeof parsed === 'object');
      const body = parsed as { error?: { code?: string } };
      assert.equal(body.error?.code, 'BUDGET_EXCEEDED');
    } finally {
      budgetExceeded = false;
      await app.close();
    }
  });
});
