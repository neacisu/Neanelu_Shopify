import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateWebhookJobPayload, type WebhookJobPayload } from '@app/types';

// Mock @app/config
void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      shopifyApiSecret: 'test-secret',
      redisUrl: 'redis://localhost:6379',
    }),
  },
});

// Mock Redis (ioredis) used in webhooks.ts
const RedisMock = class {
  quit() {
    return Promise.resolve();
  }
  set() {
    return Promise.resolve('OK');
  }
};

// With default import, we just need defaultExport
void mock.module('ioredis', {
  defaultExport: RedisMock,
});

const enqueueMock = mock.fn((_payload: WebhookJobPayload) => Promise.resolve());
const isDuplicateMock = mock.fn(() => Promise.resolve(false));
const markProcessedMock = mock.fn(() => Promise.resolve());

const queuePath = new URL('../../queue/webhook-queue.js', import.meta.url).href;
const dedupePath = new URL('../webhooks.dedupe.js', import.meta.url).href;

void mock.module(queuePath, {
  namedExports: {
    enqueueWebhookJob: enqueueMock,
    closeWebhookQueue: () => Promise.resolve(),
  },
});

void mock.module(dedupePath, {
  namedExports: {
    isDuplicateWebhook: isDuplicateMock,
    markWebhookProcessed: markProcessedMock,
  },
});

void describe('Webhook Routes', () => {
  let app: FastifyInstance;
  let webhookRoutes: unknown;

  beforeEach(async () => {
    // Dynamic import to pick up mocks
    const module = await import('../webhooks.js');
    webhookRoutes = (module as { webhookRoutes: unknown }).webhookRoutes;

    app = Fastify();
    await app.register(webhookRoutes as never);

    enqueueMock.mock.resetCalls();
    isDuplicateMock.mock.resetCalls();
    markProcessedMock.mock.resetCalls();

    isDuplicateMock.mock.mockImplementation(() => Promise.resolve(false));
  });

  afterEach(async () => {
    await app.close();
  });

  const generateHmac = (body: string, secret: string) => {
    return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  };

  void test('POST /:topic - Valid Webhook', async () => {
    const payload = JSON.stringify({ id: 123, foo: 'bar' });
    const hmac = generateHmac(payload, 'test-secret');

    const start = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/products/create',
      headers: {
        'X-Shopify-Topic': 'products/create',
        'X-Shopify-Shop-Domain': 'test.myshopify.com',
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'webhook-123',
        'Content-Type': 'application/json',
      },
      payload: payload,
    });
    const durationMs = performance.now() - start;

    assert.strictEqual(response.statusCode, 200);
    assert.ok(
      durationMs < 100,
      `Webhook ingress should be fast (<100ms). Got ${durationMs.toFixed(1)}ms`
    );
    assert.strictEqual(enqueueMock.mock.callCount(), 1);

    const firstCall = enqueueMock.mock.calls[0];
    const callArg = firstCall?.arguments?.[0] as unknown;

    assert.ok(callArg, 'Enqueue argument should exist');
    assert.ok(
      validateWebhookJobPayload(callArg),
      'Enqueue argument should match WebhookJobPayload'
    );
    const jobPayload = callArg;
    assert.strictEqual(jobPayload.shopDomain, 'test.myshopify.com');
    assert.strictEqual(jobPayload.topic, 'products/create');
    assert.strictEqual(jobPayload.webhookId, 'webhook-123');
    assert.ok(typeof jobPayload.payloadRef === 'string' && jobPayload.payloadRef.length > 0);
    assert.ok(typeof jobPayload.payloadSha256 === 'string' && jobPayload.payloadSha256.length > 0);

    assert.strictEqual(markProcessedMock.mock.callCount(), 1);
  });

  void test('POST /:topic - Invalid HMAC', async () => {
    const payload = JSON.stringify({ id: 123 });
    const hmac = 'invalid-hmac';

    const response = await app.inject({
      method: 'POST',
      url: '/products/create',
      headers: {
        'X-Shopify-Topic': 'products/create',
        'X-Shopify-Shop-Domain': 'test.myshopify.com',
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'webhook-124',
        'Content-Type': 'application/json',
      },
      payload: payload,
    });

    assert.strictEqual(response.statusCode, 401);
    assert.strictEqual(enqueueMock.mock.callCount(), 0);
  });

  void test('POST /:topic - Missing Headers', async () => {
    const payload = JSON.stringify({ id: 123 });
    const hmac = generateHmac(payload, 'test-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/products/create',
      headers: {
        // Missing Topic and Shop
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'webhook-125',
        'Content-Type': 'application/json',
      },
      payload: payload,
    });

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(enqueueMock.mock.callCount(), 0);
  });

  void test('POST /:topic - Duplicate Webhook', async () => {
    // Setup duplicate mock
    isDuplicateMock.mock.mockImplementation(() => Promise.resolve(true));

    const payload = JSON.stringify({ id: 123 });
    const hmac = generateHmac(payload, 'test-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/products/create',
      headers: {
        'X-Shopify-Topic': 'products/create',
        'X-Shopify-Shop-Domain': 'test.myshopify.com',
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'webhook-duplicate',
        'Content-Type': 'application/json',
      },
      payload: payload,
    });

    // Should return 200 OK but NOT enqueue
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(enqueueMock.mock.callCount(), 0);
  });

  void test('POST /:topic - Payload Too Large', async () => {
    const bigPayload = JSON.stringify({ data: 'x'.repeat(1_048_576) });
    const hmac = generateHmac(bigPayload, 'test-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/products/create',
      headers: {
        'X-Shopify-Topic': 'products/create',
        'X-Shopify-Shop-Domain': 'test.myshopify.com',
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': 'webhook-big',
        'Content-Type': 'application/json',
      },
      payload: bigPayload,
    });

    assert.strictEqual(response.statusCode, 413);
    assert.strictEqual(enqueueMock.mock.callCount(), 0);
  });
});
