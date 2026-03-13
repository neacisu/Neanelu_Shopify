import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface ExtractionJobLike {
  id: string;
  name: string;
  data: { shopId: string; matchId: string };
  attemptsMade?: number;
  opts?: { attempts?: number };
}

let capturedProcessor: ((job: ExtractionJobLike) => Promise<unknown>) | null = null;
let existingHarvest: { id: string; raw_html: string | null } | null = null;
let extractorImpl = () =>
  Promise.resolve({
    success: true,
    data: { title: 'External title', material: 'Cotton' },
    tokensUsed: { input: 12, output: 24 },
    latencyMs: 42,
  });

const matchDetailUpdates: Record<string, unknown>[] = [];
const createExtractionSessionMock = mock.fn(() => Promise.resolve({ id: 'session-1' }));
const updateSpecsExtractedMock = mock.fn<
  (params: {
    id: string;
    specsExtracted: Record<string, unknown>;
    extractionSessionId: string;
  }) => Promise<void>
>(() => Promise.resolve());
const maybeEnqueueConsensusAfterAutomationMock = mock.fn<
  (params: {
    client: unknown;
    shopId: string;
    productId: string;
    trigger: string;
    logger: unknown;
    context: string;
  }) => Promise<string | null>
>(() => Promise.resolve('consensus:product-1:settlement'));

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
      opts: { processor: (job: ExtractionJobLike) => Promise<unknown> }
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
      fn: (client: {
        query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string, values?: readonly unknown[]) => {
          if (sql.includes('SELECT id, source_url, product_id, source_id')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'match-1',
                  source_url: 'https://example.test/product',
                  product_id: 'product-1',
                  source_id: 'source-1',
                },
              ],
            });
          }
          if (sql.includes('FROM prod_raw_harvest')) {
            return Promise.resolve({ rows: existingHarvest ? [existingHarvest] : [] });
          }
          if (sql.includes('UPDATE prod_similarity_matches')) {
            const payload = values?.[0];
            if (typeof payload === 'string') {
              matchDetailUpdates.push(JSON.parse(payload) as Record<string, unknown>);
            }
            return Promise.resolve({ rows: [] });
          }
          if (sql.includes('SELECT id FROM external_sources')) {
            return Promise.resolve({ rows: [{ id: 'source-1' }] });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

void mock.module('@app/pim', {
  namedExports: {
    createExtractionSession: createExtractionSessionMock,
    updateSpecsExtracted: updateSpecsExtractedMock,
    XaiExtractorService: class {
      extractProductFromHTML() {
        return extractorImpl();
      }
    },
    SimpleHTMLFetcher: class {
      fetchHTML() {
        return Promise.resolve({
          html: '',
          statusCode: 500,
          contentType: 'text/html',
          fetchedAt: new Date(),
          error: 'fetch_failed',
        });
      }
    },
  },
});

void mock.module('@app/scraper', {
  namedExports: {
    scrapeProductPage: () => Promise.resolve({ status: 'failed', reason: 'fetch_failed' }),
    extractJsonLd: () => null,
  },
});

void mock.module('../../../services/ai-provider-routing.js', {
  namedExports: {
    resolveChatTaskCredentials: () =>
      Promise.resolve({
        provider: 'openai',
        model: 'gpt-5-mini',
        maxTokensPerRequest: 1200,
      }),
  },
});

void mock.module('../../../services/consensus-engine.js', {
  namedExports: {
    consensusChatCompletion: () => Promise.resolve({ result: {}, models: ['mock-model'] }),
  },
});

void mock.module('../../../services/guardrails.js', {
  namedExports: {
    scanInput: (_params: unknown) =>
      Promise.resolve({ isValid: true, sanitizedText: '<html>fixture</html>' }),
    scanOutput: (_params: unknown) =>
      Promise.resolve({
        isValid: true,
        sanitizedText: JSON.stringify({ title: 'External title', material: 'Cotton' }),
      }),
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

void mock.module('../../../otel/metrics.js', {
  namedExports: {
    decrementScraperBrowserActivePages: () => undefined,
    incrementScraperBrowserActivePages: () => undefined,
    recordPimApiUsage: () => undefined,
    recordScraperAttempt: () => undefined,
    recordScraperCheerioFastPathHit: () => undefined,
    recordScraperDeduped: () => undefined,
    recordScraperFailure: () => undefined,
    recordScraperLatency: () => undefined,
    recordScraperLoginDetected: () => undefined,
    recordScraperRobotsBlocked: () => undefined,
    recordScraperSuccess: () => undefined,
  },
});

void describe('extraction worker (unit)', () => {
  beforeEach(() => {
    existingHarvest = { id: 'harvest-1', raw_html: '<html>fixture</html>' };
    extractorImpl = () =>
      Promise.resolve({
        success: true,
        data: { title: 'External title', material: 'Cotton' },
        tokensUsed: { input: 12, output: 24 },
        latencyMs: 42,
      });
    capturedProcessor = null;
    matchDetailUpdates.length = 0;
    createExtractionSessionMock.mock.resetCalls();
    updateSpecsExtractedMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();
  });

  void it('persists extracted specs and settles consensus after successful extraction', async () => {
    const { startExtractionWorker, PIM_EXTRACTION_JOB } = await import('../extraction.worker.js');
    startExtractionWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-1',
      name: PIM_EXTRACTION_JOB,
      data: { shopId: 'shop-1', matchId: 'match-1' },
      attemptsMade: 0,
      opts: { attempts: 1 },
    });

    assert.equal(updateSpecsExtractedMock.mock.calls.length, 1);
    const updateSpecsCall = updateSpecsExtractedMock.mock.calls[0];
    assert.ok(updateSpecsCall, 'expected specs to be persisted');
    assert.deepEqual(updateSpecsCall.arguments[0], {
      id: 'match-1',
      specsExtracted: { title: 'External title', material: 'Cotton' },
      extractionSessionId: 'session-1',
    });

    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
    const settlementCall = maybeEnqueueConsensusAfterAutomationMock.mock.calls[0];
    assert.ok(settlementCall, 'expected settlement helper to be called');
    const [settlementArgs] = settlementCall.arguments;
    assert.equal(settlementArgs.productId, 'product-1');
    assert.equal(settlementArgs.trigger, 'extraction_complete');
    assert.equal(settlementArgs.context, 'extraction_completed');

    assert.equal(
      matchDetailUpdates.some((payload) => payload['extraction_status'] === 'processing'),
      true
    );
    assert.equal(
      matchDetailUpdates.some((payload) => payload['extraction_status'] === 'completed'),
      true
    );
  });

  void it('marks final extraction failures for human review and settles the pipeline', async () => {
    extractorImpl = () => Promise.reject(new Error('llm_boom'));

    const { startExtractionWorker, PIM_EXTRACTION_JOB } = await import('../extraction.worker.js');
    startExtractionWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await assert.rejects(
      capturedProcessor({
        id: 'job-2',
        name: PIM_EXTRACTION_JOB,
        data: { shopId: 'shop-1', matchId: 'match-1' },
        attemptsMade: 0,
        opts: { attempts: 1 },
      }),
      /llm_boom/
    );

    assert.equal(updateSpecsExtractedMock.mock.calls.length, 0);
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
    const settlementCall = maybeEnqueueConsensusAfterAutomationMock.mock.calls[0];
    assert.ok(settlementCall, 'expected failed extraction to settle the pipeline');
    const [settlementArgs] = settlementCall.arguments;
    assert.equal(settlementArgs.productId, 'product-1');
    assert.equal(settlementArgs.trigger, 'extraction_failed');
    assert.equal(settlementArgs.context, 'extraction_failed_final_attempt');

    assert.equal(
      matchDetailUpdates.some(
        (payload) => payload['human_review_reason'] === 'extraction_failed_final_attempt'
      ),
      true
    );
    assert.equal(
      matchDetailUpdates.some((payload) => payload['extraction_status'] === 'failed'),
      true
    );
  });
});
