import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: { session?: { shopId: string } }, _reply: unknown) => {
      req.session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
    getSessionFromRequest: () => ({
      shopId: 'shop-1',
      shopDomain: 'test.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

void mock.module('playwright-core', {
  namedExports: {
    chromium: {
      launch: () =>
        Promise.resolve({
          version: () => 'chromium-test',
          close: () => Promise.resolve(undefined),
        }),
    },
  },
});

interface DbRow {
  scraperEnabled: boolean;
  scraperRateLimitPerDomain: number;
  scraperTimeoutMs: number;
  scraperMaxConcurrentPages: number;
  scraperUserAgent: string;
  scraperRobotsCacheTtl: number;
  scraperConnectionStatus: 'unknown' | 'pending' | 'ok' | 'error' | 'disabled' | 'not_installed';
  scraperLastError: string | null;
}

let dbRow: DbRow | null = null;

function readEnvelope(response: { json: () => unknown }) {
  const body = response.json();
  assert.ok(body && typeof body === 'object');
  return body as {
    success: boolean;
    data: {
      enabled: boolean;
      rateLimitPerDomain: number;
      timeoutMs: number;
      maxConcurrentPages: number;
      userAgent: string;
      robotsCacheTtl: number;
      browserStatus: string;
    };
  };
}

void mock.module('@app/database', {
  namedExports: {
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
              scraperEnabled: false,
              scraperRateLimitPerDomain: 1,
              scraperTimeoutMs: 30000,
              scraperMaxConcurrentPages: 5,
              scraperUserAgent: 'NeaneluPIM/1.0',
              scraperRobotsCacheTtl: 86400,
              scraperConnectionStatus: 'unknown',
              scraperLastError: null,
            };
            return Promise.resolve({ rows: [] });
          }

          if (trimmed.startsWith('UPDATE shop_ai_credentials')) {
            dbRow ??= {
              scraperEnabled: false,
              scraperRateLimitPerDomain: 1,
              scraperTimeoutMs: 30000,
              scraperMaxConcurrentPages: 5,
              scraperUserAgent: 'NeaneluPIM/1.0',
              scraperRobotsCacheTtl: 86400,
              scraperConnectionStatus: 'unknown',
              scraperLastError: null,
            };
            const setClause = trimmed.split('SET')[1]?.split('WHERE')[0] ?? '';
            const assignments = setClause
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            for (const assignment of assignments) {
              const match = /\$(\d+)/.exec(assignment);
              const index = match ? Number(match[1]) - 1 : -1;
              const value = index >= 0 && values ? values[index] : undefined;
              if (assignment.startsWith('scraper_enabled =')) dbRow.scraperEnabled = Boolean(value);
              if (assignment.startsWith('scraper_rate_limit_per_domain ='))
                dbRow.scraperRateLimitPerDomain = Number(value);
              if (assignment.startsWith('scraper_timeout_ms ='))
                dbRow.scraperTimeoutMs = Number(value);
              if (assignment.startsWith('scraper_max_concurrent_pages ='))
                dbRow.scraperMaxConcurrentPages = Number(value);
              if (assignment.startsWith('scraper_user_agent ='))
                dbRow.scraperUserAgent = String(value);
              if (assignment.startsWith('scraper_robots_cache_ttl ='))
                dbRow.scraperRobotsCacheTtl = Number(value);
              if (assignment.startsWith('scraper_connection_status ='))
                dbRow.scraperConnectionStatus = String(value) as DbRow['scraperConnectionStatus'];
              if (assignment.startsWith('scraper_last_error = CASE'))
                dbRow.scraperLastError = (value as string | null) ?? null;
              if (assignment.startsWith('scraper_last_error = NULL')) dbRow.scraperLastError = null;
            }
            return Promise.resolve({ rows: [] });
          }

          if (trimmed.includes('FROM shop_ai_credentials')) {
            if (!dbRow) return Promise.resolve({ rows: [] });
            return Promise.resolve({
              rows: [
                {
                  scraperEnabled: dbRow.scraperEnabled,
                  scraperRateLimitPerDomain: dbRow.scraperRateLimitPerDomain,
                  scraperTimeoutMs: dbRow.scraperTimeoutMs,
                  scraperMaxConcurrentPages: dbRow.scraperMaxConcurrentPages,
                  scraperUserAgent: dbRow.scraperUserAgent,
                  scraperRobotsCacheTtl: dbRow.scraperRobotsCacheTtl,
                  scraperConnectionStatus: dbRow.scraperConnectionStatus,
                },
              ],
            });
          }

          if (trimmed.includes('COUNT(*)::text AS pages_scraped')) {
            return Promise.resolve({
              rows: [
                {
                  pages_scraped: '0',
                  success_count: '0',
                  failed_count: '0',
                  avg_latency_ms: '0',
                  robots_blocked: '0',
                  deduped: '0',
                  login_detected: '0',
                  cheerio_fast_path: '0',
                },
              ],
            });
          }

          if (trimmed.includes('COALESCE(agg.total')) return Promise.resolve({ rows: [] });
          if (trimmed.includes('COALESCE(NULLIF(split_part')) return Promise.resolve({ rows: [] });
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

const { scraperSettingsRoutes } = await import('../scraper-settings.js');

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
  enrichmentWorkerConcurrency: 5,
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
  openAiEmbeddingCostPer1MTokens: 0.02,
  serperDailyBudget: 1000,
  serperBudgetAlertThreshold: 0.8,
  serperHealthCheckIntervalSeconds: 3600,
  openAiHealthCheckIntervalSeconds: 3600,
  xaiHealthCheckIntervalSeconds: 3600,
  scraperEnabled: false,
  scraperRateLimitPerDomain: 1,
  scraperTimeoutMs: 30000,
  scraperMaxConcurrentPages: 5,
  scraperUserAgent: 'NeaneluPIM/1.0',
  scraperRobotsCacheTtl: 86400,
  qualityWebhookTimeoutMs: 10_000,
  qualityWebhookMaxAttempts: 3,
  qualityWebhookSweepEnabled: true,
  qualityWebhookSweepMaxAgeDays: 7,
  bulkPimSyncEnabled: true,
  bulkSemanticDedupEnabled: true,
  bulkConsensusEnabled: true,
  bulkExternalConsensusEnabled: false,
  bulkDedupeHighThreshold: 0.95,
  bulkDedupeNeedsReviewThreshold: 0.9,
  bulkDedupeMaxResults: 10,
  bulkDedupeSuspiciousThreshold: 0.85,
} as const;

void describe('Scraper Settings Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    dbRow = null;
    app = Fastify();
    await app.register(
      scraperSettingsRoutes as never,
      {
        env,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );
  });

  afterEach(async () => {
    await app.close();
  });

  void it('persists scraper settings and returns them on GET', async () => {
    const update = await app.inject({
      method: 'PUT',
      url: '/settings/scraper',
      payload: {
        enabled: true,
        rateLimitPerDomain: 7,
        timeoutMs: 45000,
        maxConcurrentPages: 9,
        userAgent: 'NeaneluBot/2.0',
        robotsCacheTtl: 1200,
      },
    });
    assert.equal(update.statusCode, 200);

    const getResp = await app.inject({ method: 'GET', url: '/settings/scraper' });
    assert.equal(getResp.statusCode, 200);
    const body = readEnvelope(getResp);
    assert.equal(body.success, true);
    assert.equal(body.data.enabled, true);
    assert.equal(body.data.rateLimitPerDomain, 7);
    assert.equal(body.data.timeoutMs, 45000);
    assert.equal(body.data.maxConcurrentPages, 9);
    assert.equal(body.data.userAgent, 'NeaneluBot/2.0');
    assert.equal(body.data.robotsCacheTtl, 1200);
    assert.equal(body.data.browserStatus, 'available');
  });
});
