import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

import type { FastifyInstance } from 'fastify';

void mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from(''),
    encryptAesGcm: () => ({
      ciphertext: Buffer.from(''),
      iv: Buffer.from(''),
      tag: Buffer.from(''),
    }),
    checkDatabaseConnection: () => Promise.resolve(true),
    getOptimalEfSearch: () => 40,
    setHnswEfSearch: () => Promise.resolve(),
    withTenantContext: async (
      _shopId: string,
      cb: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
    ) => {
      const client = {
        query: (_sql: string) => Promise.resolve({ rows: [] }) as Promise<{ rows: unknown[] }>,
      };

      return cb(client);
    },
    pool: {
      query: (sql: string) => {
        if (sql.includes('SELECT active_shop_domain')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      },
    },
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    QUEUE_NAMES: ['webhook-queue', 'sync-queue', 'bulk-queue', 'ai-batch-queue'],
    defaultQueuePolicy: () => ({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    }),
    checkAndConsumeCost: () =>
      Promise.resolve({ allowed: true, delayMs: 0, tokensRemaining: 1, tokensNow: 1 }),
    configFromEnv: () => ({}),
    createQueue: () => ({
      getJobCounts: () => Promise.resolve({ waiting: 0 }),
      close: () => Promise.resolve(),
    }),
    createRedisConnection: () => ({
      on: () => undefined,
      quit: () => Promise.resolve(undefined),
    }),
    enqueueBulkOrchestratorJob: () => Promise.resolve(),
    enqueueEnrichmentJob: () => Promise.resolve(),
    enqueueBulkIngestJob: () => Promise.resolve(),
    WEBHOOK_QUEUE_NAME: 'webhooks',
    cleanupWebhookJobsForShopDomain: () => Promise.resolve(),
  },
});

const workerRegistryPath = new URL('../../runtime/worker-registry.js', import.meta.url).href;
void mock.module(workerRegistryPath, {
  namedExports: {
    getWorkerReadiness: () => ({
      webhookWorkerOk: true,
      tokenHealthWorkerOk: true,
      bulkOrchestratorWorkerOk: true,
      bulkPollerWorkerOk: true,
      bulkMutationReconcileWorkerOk: true,
      bulkIngestWorkerOk: true,
      aiBatchWorkerOk: true,
    }),
  },
});

const authIndexPath = new URL('../../auth/index.js', import.meta.url).href;
void mock.module(authIndexPath, {
  namedExports: {
    registerAuthRoutes: () => Promise.resolve(),
  },
});

const webhooksRoutesPath = new URL('../../routes/webhooks.js', import.meta.url).href;
void mock.module(webhooksRoutesPath, {
  namedExports: {
    webhookRoutes: () => Promise.resolve(),
  },
});

const queuesRoutesPath = new URL('../../routes/queues.js', import.meta.url).href;
void mock.module(queuesRoutesPath, {
  namedExports: {
    queueRoutes: () => Promise.resolve(),
  },
});

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    getDefaultSessionConfig: () => ({
      secret: 'test',
      cookieName: 'neanelu_session',
      maxAge: 3600,
    }),
    getSessionFromRequest: () => ({
      shopId: 'shop-uuid',
      shopDomain: 'example.myshopify.com',
      createdAt: 1_700_000_000_000,
    }),
    createSessionToken: () => 'payload.signature',
    requireSession: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
  },
});

interface BuildServerOptions {
  env: {
    appHost: URL;
    redisUrl: string;
    shopifyApiSecret: string;
    shopifyApiKey: string;
  };
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

type BuildServer = (options: BuildServerOptions) => Promise<FastifyInstance>;

void describe('PR-028 backend endpoints', () => {
  void test('GET /api/session/token returns expiresAt', async () => {
    const mod = await import('../server.js');
    const buildServer = (mod as unknown as { buildServer: BuildServer }).buildServer;

    const app = await buildServer({
      env: {
        appHost: new URL('https://example.test'),
        redisUrl: 'redis://localhost:6379',
        shopifyApiSecret: 'secret',
        shopifyApiKey: 'key',
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const res = (await app.inject({ method: 'GET', url: '/api/session/token' })) as unknown as {
      statusCode: number;
      json: () => unknown;
    };
    assert.equal(res.statusCode, 200);

    const body = res.json();
    assert.ok(body && typeof body === 'object');
    const record = body as { success: boolean; data: { token: unknown; expiresAt: unknown } };

    assert.equal(record.success, true);
    assert.equal(typeof record.data.token, 'string');
    assert.equal(typeof record.data.expiresAt, 'string');

    await app.close();
  });

  void test('GET/POST /api/ui-profile works without auth', async () => {
    const mod = await import('../server.js');
    const buildServer = (mod as unknown as { buildServer: BuildServer }).buildServer;

    const app = await buildServer({
      env: {
        appHost: new URL('https://example.test'),
        redisUrl: 'redis://localhost:6379',
        shopifyApiSecret: 'secret',
        shopifyApiKey: 'key',
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const get1 = (await app.inject({ method: 'GET', url: '/api/ui-profile' })) as unknown as {
      statusCode: number;
      cookies: { name: string; value: string }[];
    };
    assert.equal(get1.statusCode, 200);

    const getAlias = (await app.inject({ method: 'GET', url: '/ui-profile' })) as unknown as {
      statusCode: number;
    };
    assert.equal(getAlias.statusCode, 200);

    const cookie = get1.cookies.find((c) => c.name === 'neanelu_ui_profile');
    assert.ok(cookie);
    const cookieHeader = cookie ? `${cookie.name}=${cookie.value}` : '';

    const post = (await app.inject({
      method: 'POST',
      url: '/api/ui-profile',
      payload: { lastShopDomain: 'demo.myshopify.com' },
      headers: { cookie: cookieHeader },
    })) as unknown as { statusCode: number };
    assert.equal(post.statusCode, 200);

    const postAlias = (await app.inject({
      method: 'POST',
      url: '/ui-profile',
      payload: { lastShopDomain: 'demo2.myshopify.com' },
      headers: { cookie: cookieHeader },
    })) as unknown as { statusCode: number };
    assert.equal(postAlias.statusCode, 200);

    await app.close();
  });
});
