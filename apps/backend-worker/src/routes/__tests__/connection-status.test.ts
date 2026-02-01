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
  },
});

const tokenLifecyclePath = new URL('../../auth/token-lifecycle.js', import.meta.url).href;
void mock.module(tokenLifecyclePath, {
  namedExports: {
    checkTokenHealth: () => Promise.resolve({ valid: true, needsReauth: false }),
  },
});

void mock.module('@app/database', {
  namedExports: {
    pool: {
      query: () => Promise.resolve({ rows: [{ scopes: ['read_products'] }] }),
    },
  },
});

void describe('connection status routes', () => {
  void it('returns connected status when token is healthy', async () => {
    const { connectionStatusRoutes } = await import('../connection-status.js');
    const app = Fastify();
    await app.register(connectionStatusRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/settings/connection' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { shopifyApiStatus?: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.shopifyApiStatus, 'connected');
  });
});
