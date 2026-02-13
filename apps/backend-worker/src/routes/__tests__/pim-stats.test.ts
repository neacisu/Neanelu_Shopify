import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const requireSessionMock = () => (req: unknown, _reply: unknown) => {
  (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
  return Promise.resolve();
};
const queueState = {
  paused: false,
  resumed: false,
  pausedByName: new Set<string>(),
};

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    ENRICHMENT_QUEUE_NAME: 'pim-enrichment-queue',
    COST_SENSITIVE_QUEUE_NAMES: [
      'ai-batch-queue',
      'bulk-ingest-queue',
      'pim-enrichment-queue',
      'pim-similarity-search',
      'pim-ai-audit',
      'pim-extraction',
    ],
    configFromEnv: () => ({}) as never,
    createQueue: (_ctx: unknown, opts: { name?: string }) => {
      const queueName = opts.name ?? 'unknown';
      return {
        pause: () => {
          queueState.paused = true;
          queueState.pausedByName.add(queueName);
          return Promise.resolve();
        },
        resume: () => {
          queueState.resumed = true;
          queueState.pausedByName.delete(queueName);
          return Promise.resolve();
        },
        isPaused: () => Promise.resolve(queueState.pausedByName.has(queueName)),
        close: () => Promise.resolve(),
      };
    },
  },
});

void mock.module('@app/pim', {
  namedExports: {
    checkAllBudgets: () =>
      Promise.resolve([
        {
          provider: 'serper',
          primary: { unit: 'requests', used: 800, limit: 1000, remaining: 200, ratio: 0.8 },
          alertThreshold: 0.8,
          exceeded: false,
          alertTriggered: true,
        },
        {
          provider: 'xai',
          primary: { unit: 'dollars', used: 40, limit: 100, remaining: 60, ratio: 0.4 },
          alertThreshold: 0.8,
          exceeded: false,
          alertTriggered: false,
        },
      ]),
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
          if (sql.includes('completed_today')) {
            return Promise.resolve({ rows: [{ completed_today: '2' }] });
          }
          if (sql.includes('completed_week')) {
            return Promise.resolve({ rows: [{ completed_week: '3' }] });
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
          if (sql.includes('MIN(qe.created_at)') && sql.includes('prod_quality_events')) {
            return Promise.resolve({ rows: [{ min_date: '2026-02-01', max_date: '2026-02-04' }] });
          }
          if (
            sql.includes('new_level') &&
            sql.includes('prod_quality_events') &&
            sql.includes('generate_series')
          ) {
            return Promise.resolve({
              rows: [
                { day: '2026-02-03', bronze: '2', silver: '1', golden: '0', review: '0' },
                { day: '2026-02-04', bronze: '1', silver: '0', golden: '1', review: '0' },
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
          if (
            sql.includes('AVG(response_time_ms)') &&
            sql.includes('GROUP BY api_provider, endpoint')
          ) {
            return Promise.resolve({
              rows: [
                { api_provider: 'serper', endpoint: 'search', avg_ms: '3000' },
                { api_provider: 'xai', endpoint: 'ai-audit', avg_ms: '10000' },
                { api_provider: 'xai', endpoint: 'extract-product', avg_ms: '60000' },
              ],
            });
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
                  openai_daily_budget: '5',
                  openai_budget_alert_threshold: '0.8',
                },
              ],
            });
          }
          if (sql.includes('UPDATE shop_ai_credentials')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
          if (sql.includes('FROM pim_notifications') && sql.includes('COUNT(*)::text')) {
            return Promise.resolve({ rows: [{ count: '2' }] });
          }
          if (sql.includes('FROM pim_notifications')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'notif-1',
                  type: 'weekly_cost_summary',
                  title: 'Weekly API cost summary',
                  body: { totalCost: 10 },
                  read: false,
                  created_at: '2026-02-10T10:00:00Z',
                },
              ],
            });
          }
          if (sql.includes('UPDATE pim_notifications')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
          if (sql.includes('FROM prod_quality_events') && sql.includes('COUNT')) {
            return Promise.resolve({ rows: [{ count: '2' }] });
          }
          if (sql.includes('MIN(created_at)') && sql.includes('FROM api_usage_log')) {
            return Promise.resolve({ rows: [{ min_date: '2026-02-01', max_date: '2026-02-04' }] });
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

  void test('GET /pim/stats/cost-tracking/budget-status returns provider budgets', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/stats/cost-tracking/budget-status',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { providers: unknown[] } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.providers.length >= 2, true);
    } finally {
      await server.close();
    }
  });

  void test('POST /pim/stats/cost-tracking/pause-enrichment pauses queue', async () => {
    const server = await createServer();
    queueState.paused = false;
    queueState.pausedByName.clear();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/pim/stats/cost-tracking/pause-enrichment',
      });
      assert.equal(response.statusCode, 200);
      assert.equal(queueState.paused, true);
    } finally {
      await server.close();
    }
  });

  void test('POST /pim/stats/cost-tracking/resume-enrichment resumes queue', async () => {
    const server = await createServer();
    queueState.resumed = false;
    queueState.pausedByName.add('pim-enrichment-queue');
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/pim/stats/cost-tracking/resume-enrichment',
      });
      assert.equal(response.statusCode, 200);
      assert.equal(queueState.resumed, true);
    } finally {
      await server.close();
    }
  });

  void test('POST /pim/stats/cost-tracking/pause-all-cost-queues pauses all queues', async () => {
    const server = await createServer();
    queueState.pausedByName.clear();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/pim/stats/cost-tracking/pause-all-cost-queues',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { queues: unknown[] } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.queues.length >= 6, true);
    } finally {
      await server.close();
    }
  });

  void test('POST /pim/stats/cost-tracking/resume-all-cost-queues resumes all queues', async () => {
    const server = await createServer();
    queueState.pausedByName = new Set([
      'ai-batch-queue',
      'bulk-ingest-queue',
      'pim-enrichment-queue',
      'pim-similarity-search',
      'pim-ai-audit',
      'pim-extraction',
    ]);
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/pim/stats/cost-tracking/resume-all-cost-queues',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { queues: unknown[] } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.queues.length >= 6, true);
    } finally {
      await server.close();
    }
  });

  void test('GET /pim/stats/cost-tracking/budget-guard-status returns provider and queue state', async () => {
    const server = await createServer();
    queueState.pausedByName = new Set(['pim-enrichment-queue']);
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/stats/cost-tracking/budget-guard-status',
      });
      assert.equal(response.statusCode, 200);
      const body: {
        success: boolean;
        data: { providers: unknown[]; queues: unknown[] };
      } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.providers.length >= 2, true);
      assert.equal(body.data.queues.length >= 6, true);
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

  void test('GET /pim/notifications returns list', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/notifications',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { notifications: unknown[] } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.notifications.length, 1);
    } finally {
      await server.close();
    }
  });

  void test('GET /pim/notifications/unread-count returns count', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/pim/notifications/unread-count',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { count: number } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.count, 2);
    } finally {
      await server.close();
    }
  });

  void test('PUT /pim/notifications/:id/read updates notification', async () => {
    const server = await createServer();
    try {
      const response = await server.inject({
        method: 'PUT',
        url: '/pim/notifications/notif-1/read',
      });
      assert.equal(response.statusCode, 200);
      const body: { success: boolean; data: { updated: boolean } } = response.json();
      assert.equal(body.success, true);
      assert.equal(body.data.updated, true);
    } finally {
      await server.close();
    }
  });
});
