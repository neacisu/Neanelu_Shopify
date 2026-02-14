import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

let currentShopId = 'shop-1';
const requireSessionMock = () => (req: unknown, _reply: unknown) => {
  (req as { session?: { shopId: string } }).session = { shopId: currentShopId };
  return Promise.resolve();
};

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
  },
});

let queryCount = 0;
void mock.module('@app/database', {
  namedExports: {
    withTenantContext: (
      _shopId: string,
      fn: (client: {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => unknown
    ) => {
      const client = {
        query: (sql: string, _params?: unknown[]) => {
          queryCount += 1;
          if (sql.includes('FROM mv_pim_quality_progress')) {
            return Promise.resolve({
              rows: [
                {
                  data_quality_level: 'bronze',
                  product_count: '1',
                  percentage: '100',
                  avg_quality_score: '0.6',
                  needs_review_count: '0',
                  promoted_to_silver_24h: '0',
                  promoted_to_golden_24h: '0',
                  promoted_to_silver_7d: '0',
                  promoted_to_golden_7d: '0',
                  refreshed_at: '2026-02-04T10:00:00Z',
                },
              ],
            });
          }
          if (sql.includes('MIN(qe.created_at)')) {
            return Promise.resolve({ rows: [{ min_date: null, max_date: null }] });
          }
          if (sql.includes('FROM mv_pim_source_performance')) {
            return Promise.resolve({
              rows: [
                {
                  source_type: 'SUPPLIER',
                  source_name: 'Supplier A',
                  total_harvests: '10',
                  successful_harvests: '8',
                  pending_harvests: '1',
                  failed_harvests: '1',
                  success_rate: '80',
                  trust_score: '0.8',
                  is_active: true,
                  last_harvest_at: '2026-02-04T08:00:00Z',
                  refreshed_at: '2026-02-04T10:00:00Z',
                },
              ],
            });
          }
          if (sql.includes('FROM mv_pim_enrichment_status')) {
            return Promise.resolve({
              rows: [
                {
                  data_quality_level: 'bronze',
                  channel: 'shopify',
                  product_count: '10',
                  synced_count: '6',
                  sync_rate: '60',
                  avg_quality_score: '0.62',
                  refreshed_at: '2026-02-04T10:00:00Z',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return Promise.resolve(fn(client));
    },
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    ENRICHMENT_QUEUE_NAME: 'pim-enrichment-queue',
    COST_SENSITIVE_QUEUE_NAMES: [],
    configFromEnv: () => ({}) as never,
    enqueueEnrichmentJob: () => Promise.resolve(),
    createQueue: () => ({
      pause: () => Promise.resolve(),
      resume: () => Promise.resolve(),
      isPaused: () => Promise.resolve(false),
      close: () => Promise.resolve(),
    }),
  },
});

void mock.module('@app/pim', {
  namedExports: {
    checkAllBudgets: () => Promise.resolve([]),
  },
});

async function createServer(): Promise<FastifyInstance> {
  const server = Fastify();
  const { pimStatsRoutes } = await import('../pim-stats.js');
  await server.register(pimStatsRoutes, {
    env: {} as never,
    logger: console as never,
    sessionConfig: {} as never,
  });
  await server.ready();
  return server;
}

void describe('pim-stats cache', () => {
  void test('quality-distribution uses cached response for repeated request', async () => {
    queryCount = 0;
    const server = await createServer();
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution?from=2026-02-01T00:00:00Z',
      });
      assert.equal(first.statusCode, 200);
      const firstBody: { success: boolean } = first.json();
      assert.equal(firstBody.success, true);
      const afterFirst = queryCount;
      assert.equal(afterFirst >= 2, true);

      const second = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution?from=2026-02-01T00:00:00Z',
      });
      assert.equal(second.statusCode, 200);
      const secondBody: { success: boolean } = second.json();
      assert.equal(secondBody.success, true);

      // No additional DB calls are expected because response is cached for 60s.
      assert.equal(queryCount, afterFirst);
    } finally {
      await server.close();
    }
  });

  void test('source-performance uses cached response for repeated request', async () => {
    queryCount = 0;
    const server = await createServer();
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/pim/stats/source-performance',
      });
      assert.equal(first.statusCode, 200);
      const afterFirst = queryCount;
      assert.equal(afterFirst >= 1, true);

      const second = await server.inject({
        method: 'GET',
        url: '/pim/stats/source-performance',
      });
      assert.equal(second.statusCode, 200);
      assert.equal(queryCount, afterFirst);
    } finally {
      await server.close();
    }
  });

  void test('enrichment-sync uses cached response for repeated request', async () => {
    queryCount = 0;
    const server = await createServer();
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/pim/stats/enrichment-sync',
      });
      assert.equal(first.statusCode, 200);
      const afterFirst = queryCount;
      assert.equal(afterFirst >= 1, true);

      const second = await server.inject({
        method: 'GET',
        url: '/pim/stats/enrichment-sync',
      });
      assert.equal(second.statusCode, 200);
      assert.equal(queryCount, afterFirst);
    } finally {
      await server.close();
    }
  });

  void test('cache entry expires after TTL', async () => {
    queryCount = 0;
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    const server = await createServer();
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution',
      });
      assert.equal(first.statusCode, 200);
      const afterFirst = queryCount;
      assert.equal(afterFirst >= 2, true);

      now += 61_000;
      const second = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution',
      });
      assert.equal(second.statusCode, 200);
      assert.equal(queryCount > afterFirst, true);
    } finally {
      Date.now = originalNow;
      await server.close();
    }
  });

  void test('cache key is isolated by shop id', async () => {
    queryCount = 0;
    currentShopId = 'shop-1';
    const server = await createServer();
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution',
      });
      assert.equal(first.statusCode, 200);
      const afterFirst = queryCount;

      currentShopId = 'shop-2';
      const second = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution',
      });
      assert.equal(second.statusCode, 200);
      assert.equal(queryCount > afterFirst, true);
    } finally {
      currentShopId = 'shop-1';
      await server.close();
    }
  });
});
