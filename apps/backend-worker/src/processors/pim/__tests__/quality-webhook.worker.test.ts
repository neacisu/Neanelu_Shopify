import { test, describe, mock } from 'node:test';
import assert from 'node:assert';

const createWorkerMock = mock.fn(() => ({
  worker: {
    close: () => Promise.resolve(undefined),
  },
}));

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      qualityWebhookTimeoutMs: 1000,
      redisUrl: 'redis://localhost:6379',
      bullmqProToken: 'x',
      maxActivePerShop: 1,
      maxGlobalConcurrency: 1,
      starvationTimeoutMs: 1000,
      enrichmentWorkerConcurrency: 1,
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}),
    createWorker: createWorkerMock,
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: (
      _shopId: string,
      fn: (client: { query: () => Promise<{ rows: unknown[] }> }) => unknown
    ) => Promise.resolve(fn({ query: () => Promise.resolve({ rows: [] }) })),
  },
});

void mock.module('@app/pim', {
  namedExports: {
    getQualityEventById: () => null,
    fetchWebhookConfig: () => ({ enabled: false, url: null, subscribedEvents: [] }),
    dispatchQualityWebhook: () => ({
      ok: true,
      httpStatus: 200,
      error: null,
      responseBody: '{}',
      durationMs: 1,
    }),
    logWebhookDelivery: () => undefined,
    markEventWebhookSent: () => undefined,
    buildQualityPayload: () => ({}),
  },
});

void mock.module('../../../otel/metrics.js', {
  namedExports: {
    recordQualityWebhookDispatched: () => undefined,
    recordQualityWebhookDuration: () => undefined,
  },
});

void mock.module('../../../queue/quality-webhook-queue.js', {
  namedExports: {
    QUALITY_WEBHOOK_QUEUE_NAME: 'pim-quality-webhook',
  },
});

void describe('quality webhook worker', () => {
  void test('startQualityWebhookWorker returns close handle', async () => {
    const { startQualityWebhookWorker } = await import('../quality-webhook.worker.js');
    const handle = startQualityWebhookWorker(console as never);
    assert.equal(typeof handle.close, 'function');
    await handle.close();
  });
});
