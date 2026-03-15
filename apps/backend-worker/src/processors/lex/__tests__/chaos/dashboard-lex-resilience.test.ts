import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const shouldRun = process.env['RUN_CHAOS_TESTS'] === '1';

const requireSessionMock = () => (_req: unknown, _reply: unknown) => Promise.resolve();

const sessionPath = new URL('../../../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
    getSessionFromRequest: () => ({
      shopId: 'chaos-shop',
      shopDomain: 'chaos.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

const latencyPath = new URL('../../../../runtime/http-latency.js', import.meta.url).href;
void mock.module(latencyPath, {
  namedExports: {
    getHttpLatencySnapshot: () => ({ windowMs: 300000, sampleCount: 10, p95Seconds: 0.22 }),
  },
});

void mock.module('@app/database', {
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
              rows: [{ total_products: '25', cnt: '25' } as unknown as TRow],
            });
          if (sql.includes("status IN ('pending', 'running')"))
            return Promise.resolve({ rows: [{ active_runs: '1' } as unknown as TRow] });
          if (sql.includes('http_status >= 400'))
            return Promise.resolve({
              rows: [{ total_count: '100', error_count: '1' } as unknown as TRow],
            });
          if (sql.includes('percentile_cont(0.95)'))
            return Promise.resolve({ rows: [{ p95_ms: 125 } as unknown as TRow] });
          if (sql.includes('FROM prod_channel_mappings')) {
            return Promise.resolve({
              rows: [
                { golden_count: '18', total_count: '25', avg_score: '0.81' } as unknown as TRow,
              ],
            });
          }
          if (sql.includes("queue_name LIKE '%enrichment%'")) {
            return Promise.resolve({
              rows: [{ success_count: '28', total_count: '30' } as unknown as TRow],
            });
          }
          if (sql.includes('estimated_cost'))
            return Promise.resolve({ rows: [{ total_cost: '6.1' } as unknown as TRow] });
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

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: (_env: unknown) => ({}),
    createRedisConnection: () => ({
      on: () => undefined,
      ping: () => 'PONG',
      hget: () => '0',
      hgetall: () => ({ webhook: '0' }),
      quit: () => undefined,
      scan: () => ['0', []] as [string, string[]],
      pipeline: () => ({ del: () => undefined, exec: () => [] }),
      set: () => 'OK',
    }),
    createQueue: (_ctx: unknown, _opts: { name: string }) => ({
      getJobCounts: () => ({ waiting: 0, delayed: 0, active: 0, completed: 0, failed: 0 }),
      add: () => undefined,
      close: () => undefined,
    }),
  },
});

const lexOpsPath = new URL('../../../../services/lex-ops.js', import.meta.url).href;
void mock.module(lexOpsPath, {
  namedExports: {
    collectLexMetrics: () => Promise.reject(new Error('lex_metrics_unavailable')),
  },
});

void describe('chaos: lexical dashboard resilience', { skip: !shouldRun }, () => {
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

  void it('keeps dashboard summary, alerts, and health-score available when lex metrics fail', async () => {
    const summary = await app.inject({ method: 'GET', url: '/dashboard/summary' });
    const alerts = await app.inject({ method: 'GET', url: '/dashboard/alerts' });
    const health = await app.inject({ method: 'GET', url: '/dashboard/health-score' });

    assert.equal(summary.statusCode, 200);
    assert.equal(alerts.statusCode, 200);
    assert.equal(health.statusCode, 200);

    const summaryBody = summary.json<{
      success: boolean;
      data: { lex: { activeRuns: number; dlqEntries: number; workersTotal: number } };
    }>();
    const healthBody = health.json<{
      success: boolean;
      data: { components: { lex: { score: number; workersTotal: number } } };
    }>();
    const alertsBody = alerts.json<{ success: boolean; data: { alerts: { id: string }[] } }>();

    assert.equal(summaryBody.success, true);
    assert.equal(summaryBody.data.lex.activeRuns, 0);
    assert.equal(summaryBody.data.lex.dlqEntries, 0);
    assert.equal(summaryBody.data.lex.workersTotal, 0);

    assert.equal(healthBody.success, true);
    assert.equal(healthBody.data.components.lex.score, 50);
    assert.equal(healthBody.data.components.lex.workersTotal, 0);

    assert.equal(alertsBody.success, true);
    assert.ok(alertsBody.data.alerts.every((alert) => !alert.id.startsWith('lex_')));
  });
});
