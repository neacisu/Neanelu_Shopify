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

const requireAdminPath = new URL('../../auth/require-admin.js', import.meta.url).href;
void mock.module(requireAdminPath, {
  namedExports: {
    requireAdmin: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
  },
});

const queryMock = mock.fn(() => Promise.resolve({ rows: [] }));
void mock.module('@app/database', {
  namedExports: {
    pool: {
      query: queryMock,
    },
  },
});

const redisPublishMock = mock.fn(() => Promise.resolve(1));
const redisConnectMock = mock.fn(() => Promise.resolve());
void mock.module('redis', {
  namedExports: {
    createClient: () => ({
      connect: redisConnectMock,
      publish: redisPublishMock,
    }),
  },
});

void describe('queue settings routes', () => {
  void it('returns queue config list', async () => {
    const { queueSettingsRoutes } = await import('../queue-settings.js');
    const app = Fastify();
    await app.register(queueSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        maxGlobalConcurrency: 10,
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/settings/queues' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { success?: boolean; data?: { queues?: unknown[] } };
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data?.queues));
  });

  void it('updates queue config with valid payload', async () => {
    const { queueSettingsRoutes } = await import('../queue-settings.js');
    const app = Fastify();
    await app.register(queueSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        maxGlobalConcurrency: 10,
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    queryMock.mock.resetCalls();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/queues',
      payload: {
        queueName: 'webhook-queue',
        concurrency: 5,
        maxAttempts: 3,
        backoffType: 'fixed',
        backoffDelayMs: 1000,
        dlqRetentionDays: 14,
      },
    });

    assert.equal(response.statusCode, 200);
    const wroteConfig = queryMock.mock.calls.some((call) => {
      const sql = (call.arguments as unknown[])[0];
      return typeof sql === 'string' && sql.includes('system_config');
    });
    assert.ok(wroteConfig);
    assert.equal(redisPublishMock.mock.callCount(), 1);
  });

  void it('rejects invalid queue payload', async () => {
    const { queueSettingsRoutes } = await import('../queue-settings.js');
    const app = Fastify();
    await app.register(queueSettingsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        maxGlobalConcurrency: 10,
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/queues',
      payload: {
        queueName: '',
        concurrency: 0,
      },
    });

    assert.equal(response.statusCode, 400);
  });
});
