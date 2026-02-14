import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface SimilarityJobLike {
  id: string;
  name: string;
  data: { shopId: string; productId: string };
}

let capturedProcessor: ((job: SimilarityJobLike) => Promise<unknown>) | null = null;

interface SimilarityEnqueuePayload {
  shopId: string;
  matchId: string;
}

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

const enqueueAIAuditJobMock = mock.fn<(payload: SimilarityEnqueuePayload) => Promise<void>>(() =>
  Promise.resolve()
);
const enqueueExtractionJobMock = mock.fn<(payload: SimilarityEnqueuePayload) => Promise<void>>(() =>
  Promise.resolve()
);

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      redisUrl: 'redis://localhost:6379',
      bullmqProToken: 'x',
      maxActivePerShop: 1,
      maxGlobalConcurrency: 1,
      starvationTimeoutMs: 1000,
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
    createWorker: (
      _ctx: unknown,
      opts: { processor: (job: SimilarityJobLike) => Promise<unknown> }
    ) => {
      capturedProcessor = opts.processor;
      return { worker: { close: () => Promise.resolve() } };
    },
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
    ) => {
      const client: { query: (sql: string) => Promise<{ rows: unknown[] }> } = {
        query: (sql: string) => {
          if (
            sql.includes('FROM prod_channel_mappings pcm') &&
            sql.includes('JOIN shopify_products')
          ) {
            return Promise.resolve({
              rows: [
                {
                  product_id: 'pim-1',
                  title: 'Produs local',
                  brand: 'Brand',
                  gtin: '4006381333931',
                  mpn: null,
                },
              ],
            });
          }
          if (sql.includes("match_confidence = 'pending'") && sql.includes('triage_decision')) {
            return Promise.resolve({ rows: [{ id: 'match-pending-1' }] });
          }
          if (sql.includes("match_confidence = 'confirmed'") && sql.includes('auto_approved')) {
            return Promise.resolve({ rows: [{ id: 'match-auto-1' }] });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

class BudgetExceededError extends Error {}

void mock.module('@app/pim', {
  namedExports: {
    BudgetExceededError,
    enforceBudget: () => Promise.resolve(),
    searchProductByGTIN: () =>
      Promise.resolve([{ url: 'https://ex', title: 'Ext', structuredData: {} }]),
    searchProductByMPN: () => Promise.resolve([]),
    searchProductByTitle: () => Promise.resolve([]),
    SimilarityMatchService: class {
      processSerperResults() {
        return Promise.resolve({ sentToAIAudit: 1, autoApproved: 1, inserted: 2, updated: 0 });
      }
    },
  },
});

void mock.module('../../../queue/similarity-queues.js', {
  namedExports: {
    enqueueAIAuditJob: enqueueAIAuditJobMock,
    enqueueExtractionJob: enqueueExtractionJobMock,
  },
});

void mock.module('../../../runtime/worker-registry.js', {
  namedExports: {
    setWorkerCurrentJob: () => undefined,
    clearWorkerCurrentJob: () => undefined,
  },
});

void describe('similarity search worker (unit)', () => {
  void it('enqueues AI audit + extraction for relevant matches', async () => {
    const { startSimilaritySearchWorker, SIMILARITY_SEARCH_JOB } =
      await import('../search-and-match.worker.js');
    startSimilaritySearchWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-1',
      name: SIMILARITY_SEARCH_JOB,
      data: { shopId: 'shop-1', productId: 'shopify-prod-1' },
    });

    assert.equal(enqueueAIAuditJobMock.mock.calls.length, 1);
    const aiAuditFirstCall = enqueueAIAuditJobMock.mock.calls[0];
    assert.ok(aiAuditFirstCall, 'expected enqueueAIAuditJob to be called');
    assert.deepEqual(aiAuditFirstCall.arguments[0], {
      shopId: 'shop-1',
      matchId: 'match-pending-1',
    });

    assert.equal(enqueueExtractionJobMock.mock.calls.length, 1);
    const extractionFirstCall = enqueueExtractionJobMock.mock.calls[0];
    assert.ok(extractionFirstCall, 'expected enqueueExtractionJob to be called');
    assert.deepEqual(extractionFirstCall.arguments[0], {
      shopId: 'shop-1',
      matchId: 'match-auto-1',
    });
  });
});
