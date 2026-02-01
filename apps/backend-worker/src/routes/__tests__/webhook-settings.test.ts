import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
  },
});

const requireAdminPath = new URL('../../auth/require-admin.js', import.meta.url).href;
void mock.module(requireAdminPath, {
  namedExports: {
    requireAdmin: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
  },
});

const registerPath = new URL('../../shopify/webhooks/register.js', import.meta.url).href;
void mock.module(registerPath, {
  namedExports: {
    REQUIRED_TOPICS: ['products/create', 'orders/create'],
    registerWebhooks: () => Promise.resolve(),
  },
});

const tokenLifecyclePath = new URL('../../auth/token-lifecycle.js', import.meta.url).href;
void mock.module(tokenLifecyclePath, {
  namedExports: {
    withTokenRetry: (
      _shopId: string,
      _key: Buffer,
      _logger: unknown,
      fn: (token: string, shopDomain: string) => Promise<unknown>
    ) => fn('token', 'demo.myshopify.com'),
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string, _values?: unknown[]) => {
          if (sql.includes('FROM shopify_webhooks')) {
            return Promise.resolve({
              rows: [
                {
                  topic: 'products/create',
                  address: 'https://example.com/webhooks/products/create',
                  format: 'json',
                  apiVersion: '2024-07',
                  createdAt: '2026-02-01T10:00:00Z',
                },
              ],
            });
          }
          if (sql.includes('FROM shops')) {
            return Promise.resolve({ rows: [{ shopify_domain: 'demo.myshopify.com' }] });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return fn(client);
    },
  },
});

const redisGetMock = mock.fn(() => Promise.resolve('received:12'));
const redisSetMock = mock.fn(() => Promise.resolve('OK'));
const redisPublishMock = mock.fn(() => Promise.resolve(1));
const redisConnectMock = mock.fn(() => Promise.resolve());

void mock.module('redis', {
  namedExports: {
    createClient: () => ({
      connect: redisConnectMock,
      get: redisGetMock,
      set: redisSetMock,
      publish: redisPublishMock,
    }),
  },
});

void describe('webhook settings routes', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    const fetchMock = mock.fn(() => Promise.resolve({ ok: true } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    redisGetMock.mock.resetCalls();
    redisSetMock.mock.resetCalls();
    redisConnectMock.mock.resetCalls();
  });

  void it('returns webhook config list', async () => {
    const { webhookSettingsRoutes } = await import('../webhook-settings.js');
    const app = Fastify();
    await app.register(webhookSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        appHost: new URL('https://example.com'),
        shopifyApiSecret: 'test-secret',
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/settings/webhooks' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { webhooks?: unknown[]; missingTopics?: string[] };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.webhooks?.length, 1);
    assert.deepEqual(body.data?.missingTopics, ['orders/create']);
  });

  void it('rejects invalid webhook topic', async () => {
    const { webhookSettingsRoutes } = await import('../webhook-settings.js');
    const app = Fastify();
    await app.register(webhookSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        appHost: new URL('https://example.com'),
        shopifyApiSecret: 'test-secret',
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/settings/webhooks/test',
      payload: { topic: 'invalid/topic' },
    });
    assert.equal(response.statusCode, 400);
  });

  void it('returns success for valid webhook test', async () => {
    const { webhookSettingsRoutes } = await import('../webhook-settings.js');
    const app = Fastify();
    await app.register(webhookSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        appHost: new URL('https://example.com'),
        shopifyApiSecret: 'test-secret',
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/settings/webhooks/test',
      payload: { topic: 'products/create' },
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { success?: boolean; latencyMs?: number };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.success, true);
    assert.equal(body.data?.latencyMs, 12);
    assert.equal(redisSetMock.mock.callCount(), 1);
  });

  void it('reconciles webhooks and returns updated config', async () => {
    const { webhookSettingsRoutes } = await import('../webhook-settings.js');
    const app = Fastify();
    await app.register(webhookSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        appHost: new URL('https://example.com'),
        shopifyApiSecret: 'test-secret',
        redisUrl: 'redis://localhost:6379',
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/settings/webhooks/reconcile',
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { webhooks?: unknown[]; missingTopics?: string[] };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.webhooks?.length, 1);
  });
});
