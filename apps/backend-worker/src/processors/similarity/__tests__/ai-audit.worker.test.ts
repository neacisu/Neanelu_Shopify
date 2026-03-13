import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface AIAuditJobLike {
  id: string;
  name: string;
  data: { shopId: string; matchId: string };
}

let capturedProcessor: ((job: AIAuditJobLike) => Promise<unknown>) | null = null;
let decision: 'approve' | 'reject' | 'escalate' = 'approve';

interface EnqueueExtractionPayload {
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

const enqueueExtractionJobMock = mock.fn<(payload: EnqueueExtractionPayload) => Promise<void>>(() =>
  Promise.resolve()
);
const maybeEnqueueConsensusAfterAutomationMock = mock.fn(() => Promise.resolve(null));
const updateQueries: { sql: string; values?: unknown[] }[] = [];

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
    checkAndConsumeCost: () =>
      Promise.resolve({ allowed: true, delayMs: 0, tokensRemaining: 100, tokensNow: 100 }),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
    createWorker: (
      _ctx: unknown,
      opts: { processor: (job: AIAuditJobLike) => Promise<unknown> }
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
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> } = {
        query: (sql: string, values?: unknown[]) => {
          if (sql.includes('FROM prod_similarity_matches m') && sql.includes('WHERE m.id = $2')) {
            return Promise.resolve({
              rows: [
                {
                  match_id: 'match-1',
                  similarity_score: '0.93',
                  source_url: 'https://source.test/p',
                  source_title: 'Sursa',
                  source_brand: 'BrandX',
                  source_gtin: null,
                  source_price: '10.00',
                  source_currency: 'RON',
                  product_id: 'pim-1',
                  title: 'Produs local',
                  brand: 'BrandX',
                  gtin: '4006381333931',
                  mpn: null,
                },
              ],
            });
          }
          if (sql.includes('UPDATE prod_similarity_matches')) {
            updateQueries.push(values ? { sql, values } : { sql });
            return Promise.resolve({ rows: [] });
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
    AIAuditorService: class {
      auditMatch() {
        return Promise.resolve({
          decision,
          modelUsed: 'grok-test',
          rationale: 'test',
          confidence: 0.9,
        });
      }
    },
  },
});

const aiRoutingPath = new URL('../../../services/ai-provider-routing.js', import.meta.url).href;
void mock.module(aiRoutingPath, {
  namedExports: {
    resolveChatTaskCredentials: () =>
      Promise.resolve({
        provider: 'selfhosted',
        apiKey: 'token',
        baseUrl: 'http://10.0.1.10:49001/v1',
        model: 'Qwen/QwQ-32B-AWQ',
        maxTokensPerRequest: 1200,
      }),
  },
});

void mock.module('../../../services/consensus-engine.js', {
  namedExports: {
    consensusChatCompletion: () =>
      Promise.resolve({
        result: { recommendation: 'approve' },
        rawResponses: [],
        method: 'majority',
        consensusScore: 0.9,
        participantCount: 4,
        models: ['QwQ', 'Qwen'],
        durationMs: 10,
      }),
  },
});

void mock.module('../../../services/guardrails.js', {
  namedExports: {
    scanInput: ({ text }: { text: string }) =>
      Promise.resolve({ isValid: true, sanitizedText: text, reason: null }),
    scanOutput: ({ output }: { output: string }) =>
      Promise.resolve({ isValid: true, sanitizedText: output, reason: null }),
  },
});

void mock.module('../../../queue/similarity-queues.js', {
  namedExports: {
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

void describe('ai-audit worker (unit)', () => {
  void it('approves -> confirms + enqueues extraction', async () => {
    decision = 'approve';
    updateQueries.length = 0;
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

    const { startAIAuditWorker, AI_AUDIT_JOB } = await import('../ai-audit.worker.js');
    startAIAuditWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-1',
      name: AI_AUDIT_JOB,
      data: { shopId: 'shop-1', matchId: 'match-1' },
    });

    assert.equal(enqueueExtractionJobMock.mock.calls.length, 1);
    assert.equal(updateQueries.length, 1);
    assert.equal(updateQueries[0]?.values?.[0], 'confirmed');
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
  });

  void it('rejects -> updates match as rejected and settles pipeline', async () => {
    decision = 'reject';
    updateQueries.length = 0;
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

    const { startAIAuditWorker, AI_AUDIT_JOB } = await import('../ai-audit.worker.js');
    startAIAuditWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-2',
      name: AI_AUDIT_JOB,
      data: { shopId: 'shop-1', matchId: 'match-1' },
    });

    assert.equal(enqueueExtractionJobMock.mock.calls.length, 0);
    assert.equal(updateQueries.length, 1);
    assert.equal(updateQueries[0]?.values?.[0], 'rejected');
    assert.equal(updateQueries[0]?.values?.[1], 'ai_audit_reject');
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
  });

  void it('escalates -> marks match uncertain for human review', async () => {
    decision = 'escalate';
    updateQueries.length = 0;
    enqueueExtractionJobMock.mock.resetCalls();
    maybeEnqueueConsensusAfterAutomationMock.mock.resetCalls();

    const { startAIAuditWorker, AI_AUDIT_JOB } = await import('../ai-audit.worker.js');
    startAIAuditWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-3',
      name: AI_AUDIT_JOB,
      data: { shopId: 'shop-1', matchId: 'match-1' },
    });

    assert.equal(enqueueExtractionJobMock.mock.calls.length, 0);
    assert.equal(updateQueries.length, 1);
    assert.equal(updateQueries[0]?.values?.[0], 'uncertain');
    assert.equal(updateQueries[0]?.values?.[1], null);
    assert.equal(maybeEnqueueConsensusAfterAutomationMock.mock.calls.length, 1);
  });
});
