import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
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

const openAiConfigPath = new URL('../../runtime/openai-config.js', import.meta.url).href;
void mock.module(openAiConfigPath, {
  namedExports: {
    getShopOpenAiConfig: () => ({
      enabled: true,
      openAiApiKey: 'test-key',
      openAiBaseUrl: 'https://api.openai.com',
      openAiEmbeddingsModel: 'text-embedding-3-small',
      source: 'shop',
    }),
  },
});

interface DbRow {
  enabled: boolean;
  openaiBaseUrl: string | null;
  openaiEmbeddingsModel: string | null;
  hasApiKey: boolean;
  embeddingBatchSize?: number | null;
  similarityThreshold?: number | null;
}

interface AiSettingsEnvelope {
  success: boolean;
  data: {
    enabled: boolean;
    hasApiKey: boolean;
    openaiBaseUrl?: string | null;
    openaiEmbeddingsModel?: string | null;
    embeddingBatchSize?: number | null;
    similarityThreshold?: number | null;
  };
}

interface AiHealthEnvelope {
  success: boolean;
  data: {
    status: string;
  };
}

function readEnvelope(response: { json: () => unknown }): AiSettingsEnvelope {
  const body: unknown = response.json();
  assert.ok(body && typeof body === 'object');
  return body as AiSettingsEnvelope;
}

function readHealthEnvelope(response: { json: () => unknown }): AiHealthEnvelope {
  const body: unknown = response.json();
  assert.ok(body && typeof body === 'object');
  return body as AiHealthEnvelope;
}

let dbRow: DbRow | null = null;

void mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from(''),
    encryptAesGcm: () => ({
      ciphertext: Buffer.from('cipher'),
      iv: Buffer.from('iv'),
      tag: Buffer.from('tag'),
    }),
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string, values?: unknown[]) => {
          const trimmed = sql.trim();

          if (trimmed.startsWith('INSERT INTO shop_ai_credentials')) {
            dbRow ??= {
              enabled: false,
              openaiBaseUrl: null,
              openaiEmbeddingsModel: null,
              hasApiKey: false,
              embeddingBatchSize: null,
              similarityThreshold: null,
            };
            return Promise.resolve({ rows: [] });
          }

          if (trimmed.startsWith('UPDATE shop_ai_credentials')) {
            dbRow ??= {
              enabled: false,
              openaiBaseUrl: null,
              openaiEmbeddingsModel: null,
              hasApiKey: false,
              embeddingBatchSize: null,
              similarityThreshold: null,
            };

            const setClause = trimmed.split('SET')[1];
            if (!setClause) {
              return Promise.resolve({ rows: [] });
            }

            const beforeWhere = setClause.split('WHERE')[0] ?? '';
            const assignments = beforeWhere
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item.length > 0);

            for (const assignment of assignments) {
              if (assignment.startsWith('enabled =')) {
                const match = /\$(\d+)/.exec(assignment);
                if (match && values) {
                  const index = Number(match[1]) - 1;
                  dbRow.enabled = Boolean(values[index]);
                }
              }

              if (assignment.startsWith('openai_base_url =')) {
                const match = /\$(\d+)/.exec(assignment);
                if (match && values) {
                  const index = Number(match[1]) - 1;
                  dbRow.openaiBaseUrl = (values[index] as string | null) ?? null;
                }
              }

              if (assignment.startsWith('openai_embeddings_model =')) {
                const match = /\$(\d+)/.exec(assignment);
                if (match && values) {
                  const index = Number(match[1]) - 1;
                  dbRow.openaiEmbeddingsModel = (values[index] as string | null) ?? null;
                }
              }

              if (assignment.startsWith('embedding_batch_size =')) {
                const match = /\$(\d+)/.exec(assignment);
                if (match && values) {
                  const index = Number(match[1]) - 1;
                  dbRow.embeddingBatchSize = (values[index] as number | null) ?? null;
                }
              }

              if (assignment.startsWith('similarity_threshold =')) {
                const match = /\$(\d+)/.exec(assignment);
                if (match && values) {
                  const index = Number(match[1]) - 1;
                  dbRow.similarityThreshold = (values[index] as number | null) ?? null;
                }
              }

              if (assignment.startsWith('openai_api_key_ciphertext = NULL')) {
                dbRow.hasApiKey = false;
              }

              if (assignment.startsWith('openai_api_key_ciphertext = $')) {
                dbRow.hasApiKey = true;
              }
            }

            return Promise.resolve({ rows: [] });
          }

          if (trimmed.includes('FROM shop_ai_credentials')) {
            return Promise.resolve({ rows: dbRow ? [dbRow] : [] });
          }

          return Promise.resolve({ rows: [] });
        },
      };

      return await fn(client);
    },
  },
});

const { aiSettingsRoutes } = await import('../ai-settings.js');

const env = {
  nodeEnv: 'test',
  logLevel: 'info',
  port: 65000,
  appHost: new URL('https://example.com'),
  databaseUrl: 'postgres://user:pass@localhost:5432/test',
  redisUrl: 'redis://localhost:6379',
  bullmqProToken: 'token',
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
  bulkStagingReindex: true,
  openAiApiKey: 'env-key',
  openAiBaseUrl: 'https://api.openai.com',
  openAiEmbeddingsModel: 'text-embedding-3-small',
  openAiTimeoutMs: 30_000,
  openAiBatchMaxItems: 1000,
  openAiBatchPollSeconds: 3600,
  openAiBatchRetentionDays: 30,
  openAiBatchScheduleTickSeconds: 60,
  openAiEmbeddingMaxRetries: 3,
  openAiEmbeddingBackfillEnabled: true,
  openAiEmbeddingDailyBudget: 100000,
  openAiEmbedRateLimitTokensPerMinute: 100000,
  openAiEmbedRateLimitRequestsPerMinute: 3000,
  openAiEmbedRateLimitBucketTtlMs: 60_000,
  openAiEmbedThrottleShopHourlyLimit: 50000,
  openAiEmbedThrottleShopDailyLimit: 150000,
  openAiEmbedThrottleGlobalHourlyLimit: 300000,
  openAiBatchMaxGlobal: 5,
  vectorSearchCacheTtlSeconds: 60,
  vectorSearchQueryTimeoutMs: 5000,
  openAiEmbeddingDimensions: 2000,
  bulkPimSyncEnabled: true,
  bulkSemanticDedupEnabled: true,
  bulkConsensusEnabled: true,
  bulkDedupeHighThreshold: 0.9,
  bulkDedupeNeedsReviewThreshold: 0.8,
  bulkDedupeMaxResults: 30,
  bulkDedupeSuspiciousThreshold: 0.95,
} as const;

void describe('AI Settings Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    dbRow = null;
    app = Fastify();
    await app.register(
      aiSettingsRoutes as never,
      {
        env,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );
  });

  void it('returns defaults when no row exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/settings/ai' });
    assert.equal(response.statusCode, 200);

    const body = readEnvelope(response);
    assert.equal(body.success, true);
    assert.equal(body.data.enabled, false);
    assert.equal(body.data.hasApiKey, false);
    assert.equal(body.data.openaiBaseUrl, env.openAiBaseUrl);
    assert.equal(body.data.openaiEmbeddingsModel, env.openAiEmbeddingsModel);
    assert.equal(body.data.embeddingBatchSize, 100);
    assert.equal(body.data.similarityThreshold, 0.8);
  });

  void it('updates settings and stores api key flag', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: {
        enabled: true,
        apiKey: 'sk-test',
        openaiBaseUrl: 'https://api.openai.com',
        openaiEmbeddingsModel: 'text-embedding-3-large',
        embeddingBatchSize: 120,
        similarityThreshold: 0.9,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = readEnvelope(response);
    assert.equal(body.data.enabled, true);
    assert.equal(body.data.hasApiKey, true);
    assert.equal(body.data.openaiEmbeddingsModel, 'text-embedding-3-large');
    assert.equal(body.data.embeddingBatchSize, 120);
    assert.equal(body.data.similarityThreshold, 0.9);
  });

  void it('clears api key when empty string provided', async () => {
    dbRow = {
      enabled: true,
      openaiBaseUrl: 'https://api.openai.com',
      openaiEmbeddingsModel: 'text-embedding-3-small',
      hasApiKey: true,
      embeddingBatchSize: 100,
      similarityThreshold: 0.8,
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: {
        apiKey: '',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = readEnvelope(response);
    assert.equal(body.data.hasApiKey, false);
  });

  void it('returns healthy OpenAI status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, status: 200 } as Response)
    ) as typeof fetch;

    const response = await app.inject({ method: 'GET', url: '/settings/ai/health' });
    assert.equal(response.statusCode, 200);
    const body = readHealthEnvelope(response);
    assert.equal(body.data.status, 'ok');

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  void it('rejects invalid embedding batch size', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: {
        embeddingBatchSize: 5,
      },
    });

    assert.equal(response.statusCode, 400);
  });

  void it('rejects invalid similarity threshold', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/ai',
      payload: {
        similarityThreshold: 0.5,
      },
    });

    assert.equal(response.statusCode, 400);
  });
});
