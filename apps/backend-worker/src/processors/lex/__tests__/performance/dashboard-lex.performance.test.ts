import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const shouldRun = process.env['RUN_PERF_TESTS'] === '1';
const iterationCount = Number.parseInt(process.env['PERF_DASHBOARD_ITERATIONS'] ?? '40', 10);
const p95BudgetMs = Number.parseInt(process.env['PERF_DASHBOARD_P95_MS'] ?? '150', 10);

const requireSessionMock = () => (_req: unknown, _reply: unknown) => Promise.resolve();

const sessionPath = new URL('../../../../auth/session.js', import.meta.url).href;
mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
    getSessionFromRequest: () => ({
      shopId: 'perf-shop',
      shopDomain: 'perf.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

const latencyPath = new URL('../../../../runtime/http-latency.js', import.meta.url).href;
mock.module(latencyPath, {
  namedExports: {
    getHttpLatencySnapshot: () => ({ windowMs: 300000, sampleCount: 50, p95Seconds: 0.18 }),
  },
});

mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      cb: (client: {
        query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
          sql: string
        ) => Promise<{ rows: TRow[] }>;
      }) => Promise<unknown>
    ) =>
      await cb({
        query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
          sql: string
        ): Promise<{ rows: TRow[] }> => {
          if (sql.includes('FROM shopify_products'))
            return Promise.resolve({
              rows: [{ total_products: '1000', cnt: '1000' } as unknown as TRow],
            });
          if (sql.includes("status IN ('pending', 'running')"))
            return Promise.resolve({ rows: [{ active_runs: '1' } as unknown as TRow] });
          if (sql.includes('http_status >= 400'))
            return Promise.resolve({
              rows: [{ total_count: '1000', error_count: '2' } as unknown as TRow],
            });
          if (sql.includes('percentile_cont(0.95)'))
            return Promise.resolve({ rows: [{ p95_ms: 140 } as unknown as TRow] });
          if (sql.includes('FROM prod_channel_mappings')) {
            return Promise.resolve({
              rows: [
                { golden_count: '640', total_count: '1000', avg_score: '0.88' } as unknown as TRow,
              ],
            });
          }
          if (sql.includes("queue_name LIKE '%enrichment%'")) {
            return Promise.resolve({
              rows: [{ success_count: '400', total_count: '420' } as unknown as TRow],
            });
          }
          if (sql.includes('estimated_cost'))
            return Promise.resolve({ rows: [{ total_cost: '44.8' } as unknown as TRow] });
          if (sql.includes('ORDER BY started_at DESC')) {
            return Promise.resolve({
              rows: [
                { started_at: '2026-03-15T10:00:00.000Z', status: 'completed' } as unknown as TRow,
              ],
            });
          }
          return Promise.resolve({ rows: [{} as TRow] });
        },
      }),
  },
});

mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: (_env: unknown) => ({}),
    createRedisConnection: () => ({
      on: () => undefined,
      ping: () => 'PONG',
      hget: () => '12',
      hgetall: () => ({ webhook: '12' }),
      quit: () => undefined,
      scan: () => ['0', []] as [string, string[]],
      pipeline: () => ({ del: () => undefined, exec: () => [] }),
      set: () => 'OK',
    }),
    createQueue: (_ctx: unknown, _opts: { name: string }) => ({
      getJobCounts: () => ({ waiting: 4, delayed: 2, active: 1, completed: 10, failed: 0 }),
      add: () => undefined,
      close: () => undefined,
    }),
  },
});

const lexOpsPath = new URL('../../../../services/lex-ops.js', import.meta.url).href;
mock.module(lexOpsPath, {
  namedExports: {
    collectLexMetrics: () => ({
      runsTotal: 40,
      termsTotal: 400,
      clustersTotal: 80,
      glossaryTotal: 12,
      reviewPending: 4,
      reviewBacklog: 5,
      localizationsApproved: 70,
      publicationsPending: 6,
      runsActive: 2,
      runsPaused: 1,
      pausedBudgetBlocked: 1,
      pausedProviderUnavailable: 0,
      shardsFailed: 0,
      publicationsFailed: 1,
      publishConflicts: 1,
      staleCheckpoints: 0,
      retentionLag: 3600,
      aiBatchBacklog: 3,
      tmHits: 0,
      tmMisses: 0,
      tmHitRatePercent: 0,
      tmMissRatePercent: 0,
      tmAverageSimilarity: null,
      dlqEntries: 0,
      workersOnline: 14,
      workersTotal: 14,
      workers: [],
      queues: [],
      alerts: [],
    }),
  },
});

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

await describe('perf: dashboard lexical operator surface', { skip: !shouldRun }, async () => {
  let app: FastifyInstance;

  before(async () => {
    const module = await import('../../../../routes/dashboard.js');
    const dashboardRoutes = (module as { dashboardRoutes: unknown }).dashboardRoutes;

    app = Fastify();
    await app.register(
      dashboardRoutes as never,
      {
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test', redisPrefix: '' },
        logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );
  });

  after(async () => {
    await app.close();
  });

  await it('serves summary, alerts, and health-score within the mocked latency budget', async () => {
    const durations: number[] = [];
    const urls = ['/dashboard/summary', '/dashboard/alerts', '/dashboard/health-score'] as const;

    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      for (const url of urls) {
        const started = performance.now();
        const response = await app.inject({ method: 'GET', url });
        durations.push(performance.now() - started);
        assert.equal(response.statusCode, 200);
      }
    }

    const p95Ms = percentile95(durations);
    assert.ok(
      p95Ms < p95BudgetMs,
      `Expected p95 under ${p95BudgetMs}ms, got ${p95Ms.toFixed(2)}ms`
    );
  });
});
