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
            if (values) {
              updateQueries.push({ sql, values });
            } else {
              updateQueries.push({ sql });
            }
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

void mock.module('../../../services/xai-credentials.js', {
  namedExports: {
    loadXAICredentials: () =>
      Promise.resolve({
        apiKey: 'x',
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok',
        temperature: 0.1,
        maxTokensPerRequest: 1000,
        rateLimitPerMinute: 60,
        dailyBudget: 100,
        budgetAlertThreshold: 0.8,
      }),
  },
});

void mock.module('../../../queue/similarity-queues.js', {
  namedExports: {
    enqueueExtractionJob: enqueueExtractionJobMock,
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
  });

  void it('rejects -> updates match as rejected (no extraction)', async () => {
    decision = 'reject';
    updateQueries.length = 0;
    enqueueExtractionJobMock.mock.resetCalls();

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
  });
});
