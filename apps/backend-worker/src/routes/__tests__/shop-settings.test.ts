import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
    getSessionFromRequest: () => ({
      shopId: 'shop-1',
      shopDomain: 'demo.myshopify.com',
      createdAt: Date.now(),
    }),
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

const queryMock = mock.fn((sql: string, _values?: unknown[]) => {
  if (sql.includes('SELECT shopify_domain')) {
    return Promise.resolve({
      rows: [
        {
          shopifyDomain: 'demo.myshopify.com',
          timezone: 'Europe/Bucharest',
          settings: {},
        },
      ],
    });
  }
  return Promise.resolve({ rows: [] });
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
        query: queryMock,
      };
      return fn(client);
    },
  },
});

const shopifyClientPath = new URL('../../shopify/client.js', import.meta.url).href;
void mock.module(shopifyClientPath, {
  namedExports: {
    shopifyApi: {
      createClient: () => ({
        request: () =>
          Promise.resolve({ data: { shop: { name: 'Neanelu Demo', email: 'owner@demo.com' } } }),
      }),
    },
  },
});

void describe('shop settings routes', () => {
  void it('returns shop preferences and info', async () => {
    const { shopSettingsRoutes } = await import('../shop-settings.js');
    const app = Fastify();
    await app.register(shopSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/settings/shop' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { shopDomain?: string; shopName?: string; shopEmail?: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.shopDomain, 'demo.myshopify.com');
    assert.equal(body.data?.shopName, 'Neanelu Demo');
    assert.equal(body.data?.shopEmail, 'owner@demo.com');
  });

  void it('updates preferences with valid payload', async () => {
    const { shopSettingsRoutes } = await import('../shop-settings.js');
    const app = Fastify();
    await app.register(shopSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    queryMock.mock.resetCalls();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/shop',
      payload: {
        timezone: 'Europe/Bucharest',
        language: 'ro',
        notificationsEnabled: true,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(queryMock.mock.calls.some((call) => call.arguments[0].includes('UPDATE shops')));
  });

  void it('rejects invalid preferences payload', async () => {
    const { shopSettingsRoutes } = await import('../shop-settings.js');
    const app = Fastify();
    await app.register(shopSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/shop',
      payload: {
        timezone: 'Invalid/Zone',
        language: 'ro',
      },
    });

    assert.equal(response.statusCode, 400);
  });
});
