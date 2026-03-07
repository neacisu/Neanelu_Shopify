import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
  },
});

const queryMock = mock.fn((sql: unknown) => {
  if (typeof sql === 'string' && sql.includes('FROM shop_ai_credentials')) {
    return {
      rows: [
        {
          selfhostedEnabled: true,
          hasBearerToken: false,
          selfhostedEndpoints: [
            {
              id: 'qwq-main',
              label: 'QwQ Main',
              baseUrl: 'http://10.0.1.13:8000',
              modelId: 'Qwen/QwQ-32B-AWQ',
              type: 'chat',
              enabled: true,
              maxConcurrentRequests: 2,
              timeoutMs: 20000,
            },
          ],
          selfhostedConnectionStatus: 'connected',
          selfhostedLastCheckedAt: null,
          selfhostedLastSuccessAt: null,
          selfhostedLastError: null,
        },
      ],
    };
  }
  if (typeof sql === 'string' && sql.includes('FROM api_usage_log')) {
    return { rows: [{ requests: '0', inputTokens: '0', outputTokens: '0', cost: '0' }] };
  }
  return { rows: [] };
});

mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from('token'),
    encryptAesGcm: () => ({
      ciphertext: Buffer.from('cipher'),
      iv: Buffer.from('iv'),
      tag: Buffer.from('tag'),
    }),
    withTenantContext: async (
      _shopId: string,
      callback: (client: { query: typeof queryMock }) => Promise<unknown>
    ) => await callback({ query: queryMock }),
  },
});

const healthMock = mock.fn(() => ({
  status: 'ok' as const,
  checkedAt: new Date().toISOString(),
  endpoints: {
    'qwq-main': {
      status: 'ok' as const,
      latencyMs: 12,
      message: 'Endpoint reachable',
      modelsLoaded: ['Qwen/QwQ-32B-AWQ'],
    },
  },
  gpuMetrics: null,
}));

mock.module('../../services/selfhosted-health.js', {
  namedExports: {
    runSelfHostedHealthCheck: healthMock,
  },
});

const BASE_OPTS = {
  env: {
    encryptionKeyHex: '11'.repeat(32),
    encryptionKeyVersion: 1,
  },
  logger: console,
  sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
};

const VALID_ENDPOINT = {
  id: 'ep-1',
  label: 'vLLM QwQ',
  baseUrl: 'http://10.0.1.13:8000/v1',
  modelId: 'Qwen/QwQ-32B-AWQ',
  type: 'chat',
  enabled: true,
  maxConcurrentRequests: 2,
  timeoutMs: 20000,
};

async function createApp() {
  const { selfhostedSettingsRoutes } = await import('../selfhosted-settings.js');
  const app = Fastify();
  await app.register(
    selfhostedSettingsRoutes as unknown as Parameters<typeof app.register>[0],
    BASE_OPTS
  );
  return app;
}

void describe('selfhosted settings routes', () => {
  beforeEach(() => {
    queryMock.mock.resetCalls();
    healthMock.mock.resetCalls();
  });

  void it('GET returns selfhosted settings with success envelope', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/settings/selfhosted' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { endpoints?: unknown[]; connectionStatus?: string; enabled?: boolean };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.connectionStatus, 'connected');
    assert.equal(body.data?.enabled, true);
    assert.ok(Array.isArray(body.data?.endpoints));
  });

  void it('PUT rejects non-RFC1918 endpoint URLs', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [{ ...VALID_ENDPOINT, baseUrl: 'https://api.openai.com/v1' }],
      },
    });
    assert.equal(response.statusCode, 400);
  });

  void it('PUT accepts valid RFC1918 endpoint', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [VALID_ENDPOINT],
      },
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { success?: boolean };
    assert.equal(body.success, true);

    const updateCalls = queryMock.mock.calls.filter((call) => {
      const sql = (call.arguments as unknown[])[0];
      return typeof sql === 'string' && sql.includes('UPDATE shop_ai_credentials');
    });
    assert.ok(updateCalls.length > 0, 'should have executed UPDATE query');
  });

  void it('PUT accepts embedding type endpoints', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [
          {
            ...VALID_ENDPOINT,
            id: 'embed-1',
            type: 'embedding',
            modelId: 'qwen3-embedding-8b-q5km',
          },
        ],
      },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('PUT accepts 172.16.x.x RFC1918 addresses', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [{ ...VALID_ENDPOINT, baseUrl: 'http://172.16.0.5:8000/v1' }],
      },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('PUT accepts 192.168.x.x RFC1918 addresses', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [{ ...VALID_ENDPOINT, baseUrl: 'http://192.168.1.100:8000/v1' }],
      },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('PUT rejects public IP addresses', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [{ ...VALID_ENDPOINT, baseUrl: 'http://8.8.8.8:8000/v1' }],
      },
    });
    assert.equal(response.statusCode, 400);
  });

  void it('PUT encrypts bearer token when provided', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        bearerToken: 'my-secret-token',
      },
    });
    assert.equal(response.statusCode, 200);

    const tokenUpdateCalls = queryMock.mock.calls.filter((call) => {
      const sql = (call.arguments as unknown[])[0];
      return typeof sql === 'string' && sql.includes('selfhosted_bearer_token_ciphertext');
    });
    assert.ok(tokenUpdateCalls.length > 0, 'should have updated bearer token columns');
  });

  void it('PUT clears bearer token when empty string', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        bearerToken: '',
      },
    });
    assert.equal(response.statusCode, 200);

    const nullTokenCalls = queryMock.mock.calls.filter((call) => {
      const sql = (call.arguments as unknown[])[0];
      return typeof sql === 'string' && sql.includes('selfhosted_bearer_token_ciphertext = NULL');
    });
    assert.ok(nullTokenCalls.length > 0, 'should have set token columns to NULL');
  });

  void it('GET /health returns health check result', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/settings/selfhosted/health' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { status?: string; endpoints?: Record<string, unknown> };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.status, 'ok');
    assert.ok(healthMock.mock.callCount() > 0, 'should have called health check');
  });

  void it('POST /health accepts override endpoints', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/settings/selfhosted/health',
      payload: {
        endpoints: [VALID_ENDPOINT],
        bearerToken: 'test-token',
      },
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { success?: boolean };
    assert.equal(body.success, true);

    const lastCall = healthMock.mock.calls.at(-1);
    const args = (lastCall?.arguments as unknown[])?.[0] as {
      bearerTokenOverride?: string;
      endpointsOverride?: unknown;
    };
    assert.equal(args?.bearerTokenOverride, 'test-token');
    assert.ok(args?.endpointsOverride != null, 'should have passed endpoints override');
  });

  void it('PUT sets connection status to pending when enabling', async () => {
    const app = await createApp();
    await app.inject({
      method: 'PUT',
      url: '/settings/selfhosted',
      payload: {
        enabled: true,
        endpoints: [VALID_ENDPOINT],
      },
    });

    const updateCall = queryMock.mock.calls.find((call) => {
      const sql = (call.arguments as unknown[])[0];
      return typeof sql === 'string' && sql.includes('selfhosted_connection_status');
    });
    assert.ok(updateCall, 'should have set connection status');
    const args = updateCall?.arguments as unknown[];
    const values = args?.[1] as unknown[];
    assert.ok(values?.includes('pending'), 'status should be pending when enabling');
  });
});
