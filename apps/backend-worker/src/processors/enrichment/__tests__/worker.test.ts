import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface EnrichmentJobLike {
  id: string;
  name: string;
  data: { shopId: string; productIds: string[] };
}

interface EnrichmentWorkerResultLike {
  dispatched: number;
  skipped: number;
}

let capturedProcessor: ((job: EnrichmentJobLike) => Promise<unknown>) | null = null;
let budgetsExceeded = false;

function createTestLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger;
}

function assertEnrichmentResultLike(value: unknown): asserts value is EnrichmentWorkerResultLike {
  assert.ok(value && typeof value === 'object', 'expected enrichment worker result object');
  const v = value as Record<string, unknown>;
  assert.ok(typeof v['dispatched'] === 'number', 'expected dispatched:number');
  assert.ok(typeof v['skipped'] === 'number', 'expected skipped:number');
}

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      redisUrl: 'redis://localhost:6379',
      bullmqProToken: 'x',
      maxActivePerShop: 1,
      maxGlobalConcurrency: 1,
      starvationTimeoutMs: 1000,
      enrichmentWorkerConcurrency: 1,
    }),
  },
});

void mock.module('ioredis', {
  namedExports: {
    Redis: class {
      quit() {
        return Promise.resolve();
      }
    },
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    ENRICHMENT_QUEUE_NAME: 'pim-enrichment-queue',
    ENRICHMENT_JOB_NAME: 'enrich-products',
    configFromEnv: () => ({}),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
    createWorker: (
      _ctx: unknown,
      opts: { processor: (job: EnrichmentJobLike) => Promise<unknown> }
    ) => {
      capturedProcessor = opts.processor;
      return { worker: { close: () => Promise.resolve() }, dlqQueue: undefined };
    },
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (_sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client: { query: (_sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> } =
        {
          query: (_sql: string, values?: unknown[]) => {
            const raw = values?.[1];
            const productIds = Array.isArray(raw)
              ? raw.filter((v): v is string => typeof v === 'string')
              : [];
            return Promise.resolve({
              rows: productIds.map((id, idx) => ({
                product_id: `pim-${idx + 1}`,
                shopify_product_id: id,
                quality_score: '0.4',
                gtin: null,
                data_quality_level: null,
              })),
            });
          },
        };
      return await fn(client);
    },
  },
});

void mock.module('@app/pim', {
  namedExports: {
    checkAllBudgets: () =>
      Promise.resolve(
        budgetsExceeded
          ? [
              {
                provider: 'serper',
                exceeded: true,
                alertTriggered: true,
                primary: { used: 1, limit: 1, ratio: 1 },
              },
            ]
          : []
      ),
    EnrichmentOrchestrator: class {
      dispatchForEnrichment(_shopId: string, products: unknown[]) {
        return Promise.resolve({
          dispatched: products.length,
          skipped: 0,
          byPriority: { p1: 0, p2: 0, p3: products.length },
        });
      }
    },
  },
});

void mock.module('../../../queue/similarity-queues.js', {
  namedExports: {
    enqueueSimilaritySearchJob: () => Promise.resolve(),
  },
});

void mock.module('../../../runtime/worker-registry.js', {
  namedExports: {
    setWorkerCurrentJob: () => undefined,
    clearWorkerCurrentJob: () => undefined,
  },
});

void describe('enrichment worker (unit)', () => {
  void it('skips dispatch when budgets are exceeded', async () => {
    budgetsExceeded = true;
    const { startEnrichmentWorker } = await import('../worker.js');
    startEnrichmentWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    const result = await capturedProcessor({
      id: 'job-1',
      name: 'enrich-products',
      data: { shopId: 'shop-1', productIds: ['00000000-0000-4000-8000-000000000001'] },
    });

    assertEnrichmentResultLike(result);
    assert.equal(result.dispatched, 0);
    assert.equal(result.skipped, 1);
  });
});
