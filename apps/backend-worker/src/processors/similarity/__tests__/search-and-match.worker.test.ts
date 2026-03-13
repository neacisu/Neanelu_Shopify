import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface SimilarityJobLike {
  id: string;
  name: string;
  data: { shopId: string; productId: string };
}

let capturedProcessor: ((job: SimilarityJobLike) => Promise<unknown>) | null = null;
let processSummary = { sentToAIAudit: 1, autoApproved: 1, inserted: 2, updated: 0 };
let searchProductByGTINImpl = () =>
  Promise.resolve([{ url: 'https://ex', title: 'Ext', structuredData: {} }]);

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
const maybeEnqueueConsensusAfterAutomationMock = mock.fn<
  (params: {
    client: unknown;
    shopId: string;
    productId: string;
    trigger: string;
    logger: unknown;
    context: string;
  }) => Promise<string | null>
>(() => Promise.resolve(null));

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
    pool: {
      query: () => Promise.resolve({ rows: [] }),
      connect: () =>
        Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => undefined }),
    },
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
            if (sql.includes('sp.title')) {
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
            return Promise.resolve({ rows: [{ product_id: 'pim-1' }] });
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
    searchProductByGTIN: () => searchProductByGTINImpl(),
    searchProductByMPN: () => Promise.resolve([]),
    searchProductByTitle: () => Promise.resolve([]),
    SimilarityMatchService: class {
      processSerperResults() {
        return Promise.resolve(processSummary);
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

void mock.module('../../../services/pim-pipeline-state.js', {
  namedExports: {
    maybeEnqueueConsensusAfterAutomation: maybeEnqueueConsensusAfterAutomationMock,
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
    processSummary = { sentToAIAudit: 1, autoApproved: 1, inserted: 2, updated: 0 };
    enqueueAIAuditJobMock.mock.resetCalls();
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

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
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 0);
  });

  void it('enqueues fallback consensus when similarity finds no automated follow-up', async () => {
    processSummary = { sentToAIAudit: 0, autoApproved: 0, inserted: 0, updated: 0 };
    enqueueAIAuditJobMock.mock.resetCalls();
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

    const { startSimilaritySearchWorker, SIMILARITY_SEARCH_JOB } =
      await import('../search-and-match.worker.js');
    startSimilaritySearchWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-2',
      name: SIMILARITY_SEARCH_JOB,
      data: { shopId: 'shop-1', productId: 'shopify-prod-1' },
    });

    assert.equal(enqueueAIAuditJobMock.mock.calls.length, 0);
    assert.equal(enqueueExtractionJobMock.mock.calls.length, 0);
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
    const call = maybeEnqueueConsensusAfterAutomationMock.mock.calls[0];
    assert.ok(call, 'expected fallback consensus helper to be called');
    const [args] = call.arguments;
    assert.equal(args.shopId, 'shop-1');
    assert.equal(args.productId, 'pim-1');
    assert.equal(args.trigger, 'similarity_complete');
    assert.equal(args.context, 'search_and_match_no_automated_followup');
  });

  void it('settles to consensus on final similarity failure', async () => {
    processSummary = { sentToAIAudit: 1, autoApproved: 1, inserted: 2, updated: 0 };
    searchProductByGTINImpl = () => Promise.reject(new Error('serper_down'));
    enqueueAIAuditJobMock.mock.resetCalls();
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

    const { startSimilaritySearchWorker, SIMILARITY_SEARCH_JOB } =
      await import('../search-and-match.worker.js');
    startSimilaritySearchWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await assert.rejects(
      capturedProcessor({
        id: 'job-3',
        name: SIMILARITY_SEARCH_JOB,
        data: { shopId: 'shop-1', productId: 'shopify-prod-1' },
      })
    );

    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
    const call = maybeEnqueueConsensusAfterAutomationMock.mock.calls[0];
    assert.ok(call, 'expected final-attempt settlement helper to be called');
    const [args] = call.arguments;
    assert.equal(args.shopId, 'shop-1');
    assert.equal(args.productId, 'pim-1');
    assert.equal(args.trigger, 'similarity_complete');
    assert.equal(args.context, 'similarity_search_failed_final_attempt');

    searchProductByGTINImpl = () =>
      Promise.resolve([{ url: 'https://ex', title: 'Ext', structuredData: {} }]);
  });
});
