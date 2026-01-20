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
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test' },
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
