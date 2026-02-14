import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_json_object');
  }
  return parsed as Record<string, unknown>;
}

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
  },
});

const enqueueRetryMock = mock.fn(() => 'job-1');

void mock.module('../../queue/quality-webhook-queue.js', {
  namedExports: {
    enqueueQualityWebhookRetryJob: enqueueRetryMock,
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: (
      _shopId: string,
      fn: (client: { query: () => Promise<{ rows: unknown[] }> }) => unknown
    ) =>
      Promise.resolve(
        fn({
          query: (sql?: unknown, values?: unknown[]) => {
            const s = typeof sql === 'string' ? sql : '';
            if (
              s.includes('FROM prod_quality_events qe') &&
              s.includes('JOIN prod_channel_mappings')
            ) {
              const raw = Array.isArray(values) ? values[0] : undefined;
              const eventId =
                typeof raw === 'string'
                  ? raw
                  : typeof raw === 'number'
                    ? String(raw)
                    : raw && typeof raw === 'object'
                      ? (() => {
                          const maybe = raw as Record<string, unknown>;
                          const id = maybe['id'];
                          if (typeof id === 'string') return id;
                          if (typeof id === 'number') return String(id);
                          return null;
                        })()
                      : null;
              return Promise.resolve({ rows: eventId ? [{ id: eventId }] : [] });
            }
            return Promise.resolve({ rows: [] });
          },
        })
      ),
  },
});

void mock.module('@app/pim', {
  namedExports: {
    fetchWebhookConfig: () => ({
      shopId: 'shop-1',
      url: 'https://example.com/webhook',
      secret: 'abcd',
      enabled: true,
      subscribedEvents: ['quality_promoted'],
    }),
    upsertWebhookConfig: () => undefined,
    generateWebhookSecret: () => 'a'.repeat(64),
    listWebhookDeliveries: () => ({
      items: [],
      totalCount: 0,
    }),
    resetEventWebhookPending: () => undefined,
    getQualityEventById: () => ({
      id: 'evt-1',
      eventType: 'quality_promoted',
      productId: 'prod-1',
      previousLevel: 'bronze',
      newLevel: 'silver',
      qualityScoreBefore: 0.5,
      qualityScoreAfter: 0.9,
      triggerReason: 'test',
      createdAt: new Date().toISOString(),
      webhookSent: false,
      webhookSentAt: null,
      sku: 'SKU-1',
    }),
    dispatchQualityWebhook: () => ({
      ok: true,
      httpStatus: 200,
      error: null,
      responseBody: '{}',
      durationMs: 12,
    }),
    buildQualityPayload: () => ({
      event_type: 'quality_promoted',
      event_id: 'evt-t',
      product_id: 'prod-t',
      sku: 'SKU-T',
      previous_level: 'bronze',
      new_level: 'silver',
      quality_score: 0.9,
      trigger_reason: 'test',
      timestamp: new Date().toISOString(),
      shop_id: 'shop-1',
    }),
  },
});

void describe('quality webhook settings routes', () => {
  void test('GET /pim/webhooks/config returns config', async () => {
    const { qualityWebhookSettingsRoutes } = await import('../quality-webhook-settings.js');
    const server = Fastify();
    await server.register(qualityWebhookSettingsRoutes, {
      env: { nodeEnv: 'development', qualityWebhookTimeoutMs: 5000 } as never,
      logger: console as never,
      sessionConfig: {} as never,
    });
    await server.ready();
    try {
      const response = await server.inject({ method: 'GET', url: '/pim/webhooks/config' });
      assert.equal(response.statusCode, 200);
      const body = parseJsonObject(response.body);
      assert.equal(body['success'], true);
      const data = body['data'] as Record<string, unknown>;
      assert.equal(data['enabled'], true);
    } finally {
      await server.close();
    }
  });

  void test('POST /pim/webhooks/deliveries/:eventId/retry queues retry job', async () => {
    const { qualityWebhookSettingsRoutes } = await import('../quality-webhook-settings.js');
    const server = Fastify();
    await server.register(qualityWebhookSettingsRoutes, {
      env: { nodeEnv: 'development', qualityWebhookTimeoutMs: 5000 } as never,
      logger: console as never,
      sessionConfig: {} as never,
    });
    await server.ready();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/pim/webhooks/deliveries/evt-1/retry',
      });
      assert.equal(response.statusCode, 200);
      const body = parseJsonObject(response.body);
      assert.equal(body['success'], true);
      const data = body['data'] as Record<string, unknown>;
      assert.equal(data['queued'], true);
    } finally {
      await server.close();
    }
  });
});
