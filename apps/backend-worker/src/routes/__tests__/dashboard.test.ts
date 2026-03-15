import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Bypass session auth for route tests.
const requireSessionMock = () => (_req: unknown, _reply: unknown) => Promise.resolve();

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
    getSessionFromRequest: () => ({
      shopId: 'test-shop',
      shopDomain: 'test.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

const latencyPath = new URL('../../runtime/http-latency.js', import.meta.url).href;
void mock.module(latencyPath, {
  namedExports: {
    getHttpLatencySnapshot: () => ({ windowMs: 300000, sampleCount: 25, p95Seconds: 2.5 }),
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
          if (sql.includes('FROM shopify_products')) {
            return Promise.resolve({
              rows: [{ total_products: '42', cnt: '42' } as unknown as TRow],
            });
          }
          if (sql.includes('FROM bulk_runs') && sql.includes("status IN ('pending', 'running')")) {
            return Promise.resolve({ rows: [{ active_runs: '2' } as unknown as TRow] });
          }
          if (sql.includes('FROM api_usage_log') && sql.includes('http_status >= 400')) {
            return Promise.resolve({
              rows: [{ total_count: '100', error_count: '3' } as unknown as TRow],
            });
          }
          if (sql.includes('percentile_cont(0.95)')) {
            return Promise.resolve({ rows: [{ p95_ms: 333 } as unknown as TRow] });
          }
          if (sql.includes('FROM prod_channel_mappings')) {
            return Promise.resolve({
              rows: [
                { golden_count: '10', total_count: '20', avg_score: '0.75' } as unknown as TRow,
              ],
            });
          }
          if (sql.includes('FROM job_runs') && sql.includes("queue_name LIKE '%enrichment%'")) {
            return Promise.resolve({
              rows: [{ success_count: '9', total_count: '10' } as unknown as TRow],
            });
          }
          if (sql.includes('estimated_cost')) {
            return Promise.resolve({ rows: [{ total_cost: '12.5' } as unknown as TRow] });
          }
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

const lexOpsPath = new URL('../../services/lex-ops.js', import.meta.url).href;
void mock.module(lexOpsPath, {
  namedExports: {
    collectLexMetrics: () => ({
      runsTotal: 12,
      termsTotal: 50,
      clustersTotal: 18,
      glossaryTotal: 4,
      reviewPending: 2,
      reviewBacklog: 4,
      localizationsApproved: 11,
      publicationsPending: 3,
      runsActive: 2,
      runsPaused: 2,
      pausedBudgetBlocked: 1,
      pausedProviderUnavailable: 1,
      shardsFailed: 5,
      publicationsFailed: 2,
      publishConflicts: 1,
      staleCheckpoints: 3,
      retentionLag: 90061,
      aiBatchBacklog: 7,
      dlqEntries: 6,
      workersOnline: 10,
      workersTotal: 14,
      workers: [],
      queues: [],
      alerts: [],
    }),
  },
});

interface RedisStub {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  ping: () => Promise<string>;
  hgetall: (key: string) => Promise<Record<string, string>>;
  set: (...args: unknown[]) => Promise<'OK' | null>;
  scan: (...args: unknown[]) => Promise<[string, string[]]>;
  pipeline: () => { del: (key: string) => void; exec: () => Promise<[null, number][]> };
  quit: () => Promise<void>;
}

function createRedisStub(): {
  redis: RedisStub;
  state: {
    pingOk: boolean;
    hashes: Map<string, Record<string, string>>;
    strings: Map<string, string>;
    keys: Set<string>;
  };
} {
  const state = {
    pingOk: true,
    hashes: new Map<string, Record<string, string>>(),
    strings: new Map<string, string>(),
    keys: new Set<string>(),
  };

  const redis: RedisStub = {
    on: (_event: string, _handler: (...args: unknown[]) => void) => undefined,
    ping: () => {
      if (!state.pingOk) return Promise.reject(new Error('redis_down'));
      return Promise.resolve('PONG');
    },
    hgetall: (key: string) => Promise.resolve(state.hashes.get(key) ?? {}),
    set: (...args: unknown[]) => {
      const [key, value, ex, _ttl, nx] = args;
      if (typeof key !== 'string' || typeof value !== 'string') return Promise.resolve(null);
      if (ex !== 'EX' || nx !== 'NX') return Promise.resolve(null);
      if (state.strings.has(key)) return Promise.resolve(null);
      state.strings.set(key, value);
      return Promise.resolve('OK');
    },
    scan: (...args: unknown[]) => {
      const [cursor, _match, pattern] = args;
      const cur = typeof cursor === 'string' ? cursor : '0';
      const pat = typeof pattern === 'string' ? pattern : '*';

      const prefix = pat.endsWith('*') ? pat.slice(0, -1) : pat;
      const matches = Array.from(state.keys).filter((k) =>
        pat === '*' ? true : k.startsWith(prefix)
      );

      // Single batch for tests.
      return Promise.resolve<[string, string[]]>([cur === '0' ? '0' : '0', matches]);
    },
    pipeline: () => {
      const toDelete: string[] = [];
      return {
        del: (key: string) => {
          toDelete.push(key);
        },
        exec: () => {
          const results: [null, number][] = [];
          for (const k of toDelete) {
            const existed = state.keys.delete(k);
            results.push([null, existed ? 1 : 0]);
          }
          return Promise.resolve(results);
        },
      };
    },
    quit: () => Promise.resolve(undefined),
  };

  return { redis, state };
}

const queueCalls: { name: string; method: string }[] = [];

const queueStub = {
  getJobCounts: () => Promise.resolve({ waiting: 1200, delayed: 0 }),
  add: (_name: string, _data: unknown, opts?: { jobId?: string }) => {
    queueCalls.push({ name: 'sync-queue', method: `add:${opts?.jobId ?? 'noid'}` });
    return Promise.resolve();
  },
  close: () => Promise.resolve(undefined),
};

const { redis: redisMock, state: redisState } = createRedisStub();

void mock.module('@app/queue-manager', {
  namedExports: {
    QUEUE_NAMES: ['webhook-queue', 'sync-queue'],
    configFromEnv: (_env: unknown) => ({}),
    createQueue: (_ctx: unknown, opts: { name: string }) => {
      queueCalls.push({ name: opts.name, method: 'createQueue' });
      return queueStub;
    },
    createRedisConnection: (_opts: unknown) => redisMock,
    enqueueBulkIngestJob: () => Promise.resolve(undefined),
  },
});

void describe('Dashboard Routes', () => {
  let app: FastifyInstance;
  let dashboardRoutes: unknown;

  beforeEach(async () => {
    const module = await import('../dashboard.js');
    dashboardRoutes = (module as { dashboardRoutes: unknown }).dashboardRoutes;

    app = Fastify();
    await app.register(
      dashboardRoutes as never,
      {
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test', redisPrefix: '' },
        logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );

    queueCalls.splice(0, queueCalls.length);
    redisState.pingOk = true;
    redisState.strings.clear();
    redisState.hashes.clear();
    redisState.keys.clear();
  });

  afterEach(async () => {
    await app.close();
  });

  void test('GET /dashboard/activity returns 7 points', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/activity?days=7' });
    assert.strictEqual(res.statusCode, 200);
    const raw = (res as unknown as { json: () => unknown }).json();
    const body = raw as { success: boolean; data: { days: number; points: unknown[] } };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.days, 7);
    assert.strictEqual(body.data.points.length, 7);
  });

  void test('GET /dashboard/alerts caps at 3 alerts', async () => {
    redisState.pingOk = false;

    const res = await app.inject({ method: 'GET', url: '/dashboard/alerts' });
    assert.strictEqual(res.statusCode, 200);
    const raw = (res as unknown as { json: () => unknown }).json();
    const body = raw as { success: boolean; data: { alerts: unknown[] } };
    assert.strictEqual(body.success, true);
    assert.ok(body.data.alerts.length <= 3);
  });

  void test('GET /dashboard/summary includes lexical summary block', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/summary' });
    assert.strictEqual(res.statusCode, 200);
    const raw = (res as unknown as { json: () => unknown }).json();
    const body = raw as {
      success: boolean;
      data: {
        totalProducts: number;
        queueBacklog: number;
        lex: { activeRuns: number; dlqEntries: number; workersTotal: number };
      };
    };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.totalProducts, 42);
    assert.strictEqual(body.data.lex.activeRuns, 2);
    assert.strictEqual(body.data.lex.dlqEntries, 6);
    assert.strictEqual(body.data.lex.workersTotal, 14);
  });

  void test('GET /dashboard/health-score includes lexical component', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/health-score' });
    assert.strictEqual(res.statusCode, 200);
    const raw = (res as unknown as { json: () => unknown }).json();
    const body = raw as {
      success: boolean;
      data: {
        score: number;
        components: { lex: { score: number; dlqEntries: number; staleCheckpoints: number } };
      };
    };
    assert.strictEqual(body.success, true);
    assert.ok(body.data.score >= 0);
    assert.strictEqual(body.data.components.lex.dlqEntries, 6);
    assert.strictEqual(body.data.components.lex.staleCheckpoints, 3);
  });

  void test('POST /dashboard/actions/start-sync is rate limited', async () => {
    const first = await app.inject({ method: 'POST', url: '/dashboard/actions/start-sync' });
    assert.strictEqual(first.statusCode, 200);

    const second = await app.inject({ method: 'POST', url: '/dashboard/actions/start-sync' });
    assert.strictEqual(second.statusCode, 429);
  });

  void test('POST /dashboard/actions/clear-cache requires confirm', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/dashboard/actions/clear-cache',
      payload: { patterns: ['dashboard:*'] },
    });
    assert.strictEqual(bad.statusCode, 400);

    redisState.keys.add('dashboard:activity:v1:2026-01-01');
    redisState.keys.add('dashboard:foo');

    const ok = await app.inject({
      method: 'POST',
      url: '/dashboard/actions/clear-cache',
      payload: { confirm: true, patterns: ['dashboard:*'] },
    });
    assert.strictEqual(ok.statusCode, 200);
    const raw = (ok as unknown as { json: () => unknown }).json();
    const body = raw as { success: boolean; data: { deletedKeys: number } };
    assert.strictEqual(body.success, true);
    assert.ok(body.data.deletedKeys >= 1);
  });
});
