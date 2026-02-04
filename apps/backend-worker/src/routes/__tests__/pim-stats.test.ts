import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const requireSessionMock = () => (req: unknown, _reply: unknown) => {
  (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
  return Promise.resolve();
};

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: (
      _shopId: string,
      fn: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => unknown
    ) => {
      const client = {
        query: (sql: string) => {
          if (
            sql.includes('FROM prod_channel_mappings') &&
            sql.includes('COUNT(DISTINCT pcm.product_id)')
          ) {
            return Promise.resolve({ rows: [{ total_products: '10' }] });
          }
          if (sql.includes('FROM prod_similarity_matches') && sql.includes('COUNT(psm.id)')) {
            return Promise.resolve({
              rows: [
                {
                  total_matches: '12',
                  confirmed_matches: '5',
                  pending_matches: '4',
                  rejected_matches: '3',
                  products_with_matches: '6',
                },
              ],
            });
          }
          if (sql.includes('FROM prod_specs_normalized')) {
            return Promise.resolve({ rows: [{ products_with_specs: '4' }] });
          }
          if (sql.includes('mv_pim_quality_progress')) {
            return Promise.resolve({
              rows: [
                { data_quality_level: 'bronze', product_count: '4', percentage: '40' },
                { data_quality_level: 'silver', product_count: '3', percentage: '30' },
                { data_quality_level: 'golden', product_count: '2', percentage: '20' },
                { data_quality_level: 'review_needed', product_count: '1', percentage: '10' },
              ],
            });
          }
          if (sql.includes('generate_series') && sql.includes('prod_similarity_matches')) {
            return Promise.resolve({
              rows: [
                { day: '2026-02-03', pending: '3', completed: '2' },
                { day: '2026-02-04', pending: '2', completed: '1' },
              ],
            });
          }
          if (
            sql.includes('AVG(response_time_ms)') &&
            sql.includes("endpoint = 'extract-product'")
          ) {
            return Promise.resolve({ rows: [{ avg_latency_ms: '120000' }] });
          }
          if (sql.includes('FROM api_usage_log') && sql.includes('GROUP BY api_provider')) {
            return Promise.resolve({
              rows: [
                {
                  api_provider: 'serper',
                  total_requests: '10',
                  total_cost: '1.5',
                  avg_latency_ms: '200',
                  success_count: '9',
                },
                {
                  api_provider: 'xai',
                  total_requests: '4',
                  total_cost: '2.5',
                  avg_latency_ms: '800',
                  success_count: '4',
                },
              ],
            });
          }
          if (sql.includes('FROM api_usage_log') && sql.includes('date_trunc')) {
            return Promise.resolve({ rows: [{ serper: '1.5', xai: '2.5' }] });
          }
          if (sql.includes('FROM shop_ai_credentials')) {
            return Promise.resolve({
              rows: [
                {
                  serper_daily_budget: 10,
                  serper_budget_alert_threshold: 0.8,
                  xai_daily_budget: 20,
                  xai_budget_alert_threshold: 0.8,
                },
              ],
            });
          }
          if (sql.includes('FROM prod_quality_events') && sql.includes('COUNT')) {
            return Promise.resolve({ rows: [{ count: '2' }] });
          }
          if (sql.includes('FROM api_usage_log') && sql.includes('operation_type')) {
            return Promise.resolve({
              rows: [
                { date: '2026-02-03', operation_type: 'search', total_cost: '1' },
                { date: '2026-02-03', operation_type: 'audit', total_cost: '1.5' },
                { date: '2026-02-03', operation_type: 'extraction', total_cost: '0.5' },
              ],
            });
          }
          if (sql.includes('FROM prod_quality_events')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'evt-1',
                  event_type: 'quality_promoted',
                  product_id: 'prod-1',
                  previous_level: 'silver',
                  new_level: 'golden',
                  quality_score_after: '0.9',
                  quality_score_before: '0.7',
                  trigger_reason: 'threshold_met',
                  created_at: '2026-02-04T10:00:00Z',
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

void describe('pim-stats routes', () => {
  void test('GET /pim/stats/enrichment-progress returns progress data', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/stats/enrichment-progress',
      });

      assert.equal(response.statusCode, 200);
      const body: {
        success: boolean;
        data: { pending: number };
      } = response.json();
      assert.equal(body.success, true);
      assert.ok(body.data.pending !== undefined);
    } finally {
      await server.close();
    }
  });

  void test('GET /pim/stats/quality-distribution returns distribution data', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/stats/quality-distribution',
      });

      assert.equal(response.statusCode, 200);
      const body: {
        success: boolean;
        data: { total: number };
      } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.total, 10);
    } finally {
      await server.close();
    }
  });

  void test('GET /pim/stats/cost-tracking returns cost data', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/stats/cost-tracking',
      });

      assert.equal(response.statusCode, 200);
      const body: {
        success: boolean;
        data: { today: { total: number } };
      } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.today.total, 4);
    } finally {
      await server.close();
    }
  });

  void test('GET /pim/events/quality returns events data', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/events/quality',
      });

      assert.equal(response.statusCode, 200);
      const body: {
        success: boolean;
        data: { events: unknown[] };
      } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.events.length, 1);
    } finally {
      await server.close();
    }
  });
});
