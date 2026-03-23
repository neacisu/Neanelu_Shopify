import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── Mock: session ────────────────────────────────────────────────────
let sessionEnabled = true;

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
mock.module(sessionPath, {
  namedExports: {
    requireSession:
      () =>
      (
        request: {
          session?: { shopId: string; shopDomain: string; createdAt: number; staffUserId: string };
        },
        _reply: unknown,
        done?: () => void
      ) => {
        if (sessionEnabled) {
          request.session = {
            shopId: 'shop-1',
            shopDomain: 'test.myshopify.com',
            createdAt: Date.now(),
            staffUserId: 'staff-1',
          };
        }
        if (done) done();
      },
    getSessionFromRequest: () =>
      sessionEnabled
        ? {
            shopId: 'shop-1',
            shopDomain: 'test.myshopify.com',
            createdAt: Date.now(),
            staffUserId: 'staff-1',
          }
        : null,
  },
});

// ── Mock: require-lex-access ──────────────────────────────────────────
const lexAccessPath = new URL('../../auth/require-lex-access.js', import.meta.url).href;
mock.module(lexAccessPath, {
  namedExports: {
    requireLexModuleAccess: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    requireLexReviewAccess: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    requireLexPublishAccess: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    requireLexSettingsAccess: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    requireLexGovernanceAccess: () => (_req: unknown, _reply: unknown) => Promise.resolve(),
    resolveLexBootstrap: () =>
      Promise.resolve({
        enabled: true,
        permissions: { view: true, settings: true, review: true, publish: true, governance: true },
      }),
  },
});

// ── Mock: feature-flags ──────────────────────────────────────────────
const featureFlagsPath = new URL(
  '../../processors/bulk-operations/feature-flags.js',
  import.meta.url
).href;
mock.module(featureFlagsPath, {
  namedExports: {
    isFeatureFlagEnabled: () => true,
  },
});

// ── Mock: @app/database ──────────────────────────────────────────────
// Stack-based mock: push responses and they get consumed FIFO
const queryResponseStack: { rows: unknown[] }[] = [];

function pushQueryResponse(rows: unknown[]): void {
  queryResponseStack.push({ rows });
}

function setDefaultQueryRows(rows: unknown[]): void {
  queryResponseStack.length = 0;
  queryResponseStack.push({ rows });
}

mock.module('@app/database', {
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
      const client = {
        query: (_sql: string, _values?: unknown[]): Promise<{ rows: unknown[] }> => {
          if (queryResponseStack.length > 1) {
            const batch = queryResponseStack.shift();
            return Promise.resolve(batch ?? { rows: [] });
          }
          return Promise.resolve(queryResponseStack[0] ?? { rows: [] });
        },
      };
      return fn(client);
    },
    logAuditEvent: () => Promise.resolve(),
  },
});

// ── Mock: @app/types ─────────────────────────────────────────────────
mock.module('@app/types', {
  namedExports: {
    LEX_RUN_TYPES: ['full_rebuild', 'delta_rebuild', 'translate_only'],
    LEX_ENTITY_TYPES: ['term', 'cluster', 'localization', 'publication_target'],
    LEX_PUBLICATION_TARGET_TYPES: [
      'prod_attr_synonyms',
      'prod_translations',
      'prod_semantics',
      'shopify_collections.title_en',
      'shopify_collections.description_en',
    ],
    LEX_REVIEW_STATUSES: ['pending', 'in_review', 'approved', 'rejected', 'deferred'],
    LEX_REVIEW_SEVERITIES: ['low', 'medium', 'high', 'critical'],
    LEX_PUBLICATION_TARGET_STATUSES: [
      'pending',
      'publishing',
      'published',
      'failed',
      'orphaned',
      'conflict',
    ],
    LEX_LOCALIZATION_PUBLICATION_STATUSES: ['pending', 'approved', 'published', 'failed'],
    isLexCanonicalUuid: (value: string): boolean =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    isLexPhaseName: () => true,
  },
});

// ── Mock: lex-queues ─────────────────────────────────────────────────
const lexQueuesPath = new URL('../../queue/lex-queues.js', import.meta.url).href;
mock.module(lexQueuesPath, {
  namedExports: {
    enqueueLexPublishJob: () => Promise.resolve('queue-job-publish-1'),
    enqueueLexRunRequestedJob: () => Promise.resolve('queue-job-run-1'),
    isLexQueueName: () => true,
    retryLexDlqToMainQueue: () =>
      Promise.resolve({ retried: 3, queueName: 'lex-extract-fragments' }),
  },
});

// ── Mock: lex-ops ────────────────────────────────────────────────────
const lexOpsPath = new URL('../../services/lex-ops.js', import.meta.url).href;
mock.module(lexOpsPath, {
  namedExports: {
    collectLexMetrics: () =>
      Promise.resolve({
        runsTotal: 10,
        termsTotal: 100,
        clustersTotal: 30,
        glossaryTotal: 5,
        reviewPending: 3,
        reviewBacklog: 6,
        localizationsApproved: 20,
        publicationsPending: 4,
        runsActive: 1,
        runsPaused: 0,
        pausedBudgetBlocked: 0,
        pausedProviderUnavailable: 0,
        shardsFailed: 0,
        publicationsFailed: 1,
        publishConflicts: 0,
        staleCheckpoints: 0,
        retentionLag: 0,
        aiBatchBacklog: 0,
        tmHits: 50,
        tmMisses: 10,
        tmHitRatePercent: 83.3,
        tmMissRatePercent: 16.7,
        tmAverageSimilarity: 0.95,
        dlqEntries: 0,
        workersOnline: 8,
        workersTotal: 10,
        workers: [],
        queues: [],
        alerts: [],
      }),
    buildLexPublicationQueueLinks: () => ({}),
    calibrateLexQualityThresholds: () =>
      Promise.resolve({ autoApproveThreshold: 0.93, escalationThreshold: 0.8 }),
  },
});

// ── Mock: lex-governance ─────────────────────────────────────────────
const lexGovernancePath = new URL('../../services/lex-governance.js', import.meta.url).href;
mock.module(lexGovernancePath, {
  namedExports: {
    createLexGovernanceRequest: () =>
      Promise.resolve({ id: '00000000-0000-0000-0000-000000000001', status: 'draft', version: 1 }),
    listLexGovernanceRequests: () => Promise.resolve({ requests: [], nextPageCursor: null }),
    getLexGovernanceRequest: () =>
      Promise.resolve({ id: '00000000-0000-0000-0000-000000000001', status: 'draft', version: 1 }),
    updateLexGovernanceRequest: () =>
      Promise.resolve({ id: '00000000-0000-0000-0000-000000000001', status: 'draft', version: 2 }),
    submitLexGovernanceRequest: () =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'submitted',
        version: 2,
      }),
    approveLexGovernanceRequest: () =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'approved',
        version: 3,
      }),
    rejectLexGovernanceRequest: () =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'rejected',
        version: 3,
      }),
    cancelLexGovernanceRequest: () =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'cancelled',
        version: 2,
      }),
    applyLexGovernanceRequest: () =>
      Promise.resolve({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'applied',
        version: 4,
      }),
  },
});

// ── Mock: lex-review-actions ─────────────────────────────────────────
const lexReviewActionsPath = new URL('../../services/lex-review-actions.js', import.meta.url).href;
mock.module(lexReviewActionsPath, {
  namedExports: {
    decideLexReviewItem: () => Promise.resolve({ nextVersion: 2, status: 'approved' }),
    bulkDecideLexReviewItems: () =>
      Promise.resolve({ succeeded: [{ reviewItemId: 'r1', nextVersion: 2 }], failed: [] }),
    assignLexReviewItem: () => Promise.resolve({ nextVersion: 2, assignedTo: 'staff-1' }),
    LEX_BULK_REVIEW_DECISION_MAX_ITEMS: 100,
  },
});

// ── Mock: lex-localizations ──────────────────────────────────────────
const lexLocalizationsPath = new URL('../../services/lex-localizations.js', import.meta.url).href;
mock.module(lexLocalizationsPath, {
  namedExports: {
    getLexPublicationRollbackStatus: () => ({
      rollbackable: true,
      rollbackBlockedReason: null,
      snapshotCompleteness: 'complete',
      needsRepair: false,
    }),
    rollbackLexPublicationTarget: () => Promise.resolve('rolled_back'),
  },
});

// ── Mock: lex-publication-conflict-resolve ────────────────────────────
const lexPubConflictPath = new URL(
  '../../services/lex-publication-conflict-resolve.js',
  import.meta.url
).href;
mock.module(lexPubConflictPath, {
  namedExports: {
    resolveLexPublicationPublishConflict: () =>
      Promise.resolve({ ok: true, queueJobId: 'queue-job-conflict-1' }),
  },
});

// ── Mock: run-lifecycle ──────────────────────────────────────────────
const runLifecyclePath = new URL('../../processors/lex/run-lifecycle.js', import.meta.url).href;
mock.module(runLifecyclePath, {
  namedExports: {
    recoverLexRun: () => Promise.resolve({ recovered: true, reason: 'recovered_ok' }),
  },
});

// ── Mock: scheduled-tasks ────────────────────────────────────────────
const scheduledTasksPath = new URL('../../processors/lex/scheduled-tasks.js', import.meta.url).href;
mock.module(scheduledTasksPath, {
  namedExports: {
    reconcileLexScheduledTasks: () => Promise.resolve(),
  },
});

// ── Mock: lex-glossary-rules-snapshot ────────────────────────────────
const lexGlossarySnapshotPath = new URL(
  '../../services/lex-glossary-rules-snapshot.js',
  import.meta.url
).href;
mock.module(lexGlossarySnapshotPath, {
  namedExports: {
    computeLexGlossaryRulesSnapshotHash: () => Promise.resolve('snapshot-hash-1'),
  },
});

// ── Mock: lex-translate-only-bootstrap ──────────────────────────────
const lexTranslateOnlyPath = new URL(
  '../../services/lex-translate-only-bootstrap.js',
  import.meta.url
).href;
mock.module(lexTranslateOnlyPath, {
  namedExports: {
    findLexReuseFragmentsRunId: () => Promise.resolve('reuse-run-id'),
    insertTranslateOnlyRunShards: () => Promise.resolve(),
  },
});

// ── Mock: lex-stopword-reconcile ────────────────────────────────────
const lexStopwordReconcilePath = new URL(
  '../../services/lex-stopword-reconcile.js',
  import.meta.url
).href;
mock.module(lexStopwordReconcilePath, {
  namedExports: {
    reconcileLexStopwordTerms: () => Promise.resolve({ reconciled: 0 }),
  },
});

// ── Mock: lex-xliff ──────────────────────────────────────────────────
const lexXliffPath = new URL('../../services/lex-xliff.js', import.meta.url).href;
mock.module(lexXliffPath, {
  namedExports: {
    buildLexXliffExport: () =>
      Promise.resolve({
        xml: '<?xml version="1.0"?><xliff></xliff>',
        unitCount: 5,
      }),
    parseXliffUnits: () => [{ id: 'u1', source: 'salut', target: 'hello' }],
    importXliffUnits: () => Promise.resolve({ imported: 1, skipped: 0, errors: [] }),
  },
});

// ── Mock: pipeline-utils ─────────────────────────────────────────────
const pipelineUtilsPath = new URL('../../processors/lex/pipeline-utils.js', import.meta.url).href;
mock.module(pipelineUtilsPath, {
  namedExports: {
    sha256StableJson: () => 'stable-hash',
    DEFAULT_LEX_SOURCE_LANG: 'ro',
    DEFAULT_LEX_TARGET_LANG: 'en',
  },
});

// ── Mock: @app/queue-manager ─────────────────────────────────────────
mock.module('@app/queue-manager', {
  namedExports: {
    createRedisConnection: () => ({
      set: () => Promise.resolve(undefined),
      get: () => Promise.resolve(null),
      on: () => undefined,
      quit: () => Promise.resolve(undefined),
    }),
    configFromEnv: () => ({}),
    createQueue: () => ({
      add: () => Promise.resolve({ id: 'test-job' }),
      close: () => Promise.resolve(),
    }),
  },
});

// ── Test constants ───────────────────────────────────────────────────
const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const INVALID_UUID = 'not-a-uuid';

const ENV = {
  redisUrl: 'redis://localhost:6379',
  encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  appHost: new URL('https://example.com'),
} as const;

const LOGGER = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => LOGGER,
};

const SESSION_CONFIG = { secret: 'test', cookieName: 'neanelu_session', maxAge: 3600 };

async function createApp(): Promise<FastifyInstance> {
  const { pimLexRoutes } = await import('../pim-lex.js');
  const app = Fastify();
  app.addContentTypeParser(
    ['application/xml', 'text/xml'],
    { parseAs: 'string' },
    (_req: unknown, body: string, done: (err: null, payload: string) => void) => {
      done(null, body);
    }
  );
  await app.register(pimLexRoutes, {
    env: ENV as never,
    logger: LOGGER as never,
    sessionConfig: SESSION_CONFIG,
  });
  return app;
}

function withSession(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    sessionEnabled = true;
    try {
      await fn();
    } finally {
      sessionEnabled = true;
    }
  };
}

function withoutSession(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    sessionEnabled = false;
    try {
      await fn();
    } finally {
      sessionEnabled = true;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/settings
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/settings', () => {
  void it(
    'returns 200 with default settings when no row',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/settings' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        success: boolean;
        data: {
          settings: {
            shopId: string;
            guardrailsWarnThreshold: number;
            guardrailsWarnCount: number;
            guardrailsBlockCount: number;
            guardrailsFalsePositiveCount: number;
            guardrailsLastEvaluatedAt: string | null;
          };
        };
      }>();
      assert.equal(body.success, true);
      assert.ok(body.data.settings);
      assert.equal(body.data.settings.guardrailsWarnThreshold, 1000);
      assert.equal(body.data.settings.guardrailsWarnCount, 0);
      assert.equal(body.data.settings.guardrailsBlockCount, 0);
      assert.equal(body.data.settings.guardrailsFalsePositiveCount, 0);
      assert.equal(body.data.settings.guardrailsLastEvaluatedAt, null);
      await app.close();
    })
  );

  void it(
    'returns 200 with stored settings',
    withSession(async () => {
      setDefaultQueryRows([
        {
          shopId: 'shop-1',
          version: 2,
          enabled: true,
          sourceLang: 'ro',
          targetLangs: ['en'],
          extractScope: {},
          shardSize: 10000,
          thresholds: {},
          retentionDaysFragments: 90,
          retentionDaysOccurrences: 90,
          retentionDaysContexts: 180,
          autoPublishProducts: false,
          autoPublishAttributes: false,
          autoPublishCollections: false,
          translationMode: 'auto',
          consensusEscalationThreshold: 0.8,
          translationAutoApproveThreshold: 0.93,
          localizationAutoApproveThreshold: 0.85,
          tmEnabled: true,
          tmSimilarityThreshold: 0.92,
          qualityAuditEnabled: true,
          qualityAuditMinBatchSize: 50,
          maxTermsPerLlmBatch: 10,
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/settings' });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/settings' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PUT /pim/lex/settings
// ─────────────────────────────────────────────────────────────────────
void describe('PUT /pim/lex/settings', () => {
  void it(
    'returns 200 on valid payload',
    withSession(async () => {
      // Q1: active run check → no active runs; Q2: current settings → version 0; Q3: INSERT → version 1
      queryResponseStack.length = 0;
      pushQueryResponse([]);
      pushQueryResponse([]);
      pushQueryResponse([{ version: 1 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/pim/lex/settings',
        payload: { enabled: true, sourceLang: 'ro', targetLangs: ['en'] },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        success: boolean;
        data: {
          settings: {
            guardrailsWarnThreshold: number;
            guardrailsWarnCount: number;
            guardrailsBlockCount: number;
            guardrailsFalsePositiveCount: number;
            guardrailsLastEvaluatedAt: string | null;
          };
        };
      }>();
      assert.equal(body.success, true);
      assert.equal(body.data.settings.guardrailsWarnThreshold, 1000);
      assert.equal(body.data.settings.guardrailsWarnCount, 0);
      assert.equal(body.data.settings.guardrailsBlockCount, 0);
      assert.equal(body.data.settings.guardrailsFalsePositiveCount, 0);
      assert.equal(body.data.settings.guardrailsLastEvaluatedAt, null);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/pim/lex/settings',
        payload: { enabled: true },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/metrics
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/metrics', () => {
  void it(
    'returns 200 with metrics',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/metrics' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { metrics: { runsTotal: number } } }>();
      assert.equal(body.success, true);
      assert.equal(body.data.metrics.runsTotal, 10);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/metrics' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/runs
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/runs', () => {
  void it(
    'returns 202 on success',
    withSession(async () => {
      // buildSourceSnapshotHash queries (3 source tables), then active run check, then INSERT, then shard inserts
      queryResponseStack.length = 0;
      pushQueryResponse([{ maxUpdatedAt: null, rowCount: '0' }]);
      pushQueryResponse([{ maxUpdatedAt: null, rowCount: '0' }]);
      pushQueryResponse([{ maxUpdatedAt: null, rowCount: '0' }]);
      pushQueryResponse([]);
      pushQueryResponse([{ id: VALID_UUID, createdAt: new Date().toISOString() }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/runs',
        payload: { runType: 'delta_rebuild' },
      });
      assert.equal(res.statusCode, 202);
      const body = res.json<{ success: boolean; data: { runId: string } }>();
      assert.equal(body.success, true);
      assert.ok(body.data.runId);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid runType',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/runs',
        payload: { runType: 'invalid_type' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/runs',
        payload: { runType: 'delta_rebuild' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/runs
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/runs', () => {
  void it(
    'returns 200 with runs list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/runs' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { runs: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.runs));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/runs' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/runs/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/runs/:id', () => {
  void it(
    'returns 200 when run exists',
    withSession(async () => {
      setDefaultQueryRows([
        {
          id: VALID_UUID,
          runType: 'delta_rebuild',
          status: 'completed',
          currentPhase: 'publish',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceScope: null,
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/runs/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when run not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/runs/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/runs/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/runs/${VALID_UUID}` });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/runs/:id/recover
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/runs/:id/recover', () => {
  void it(
    'returns 200 on successful recovery',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'POST', url: `/pim/lex/runs/${VALID_UUID}/recover` });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { recovered: boolean } }>();
      assert.equal(body.data.recovered, true);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/runs/${INVALID_UUID}/recover`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'POST', url: `/pim/lex/runs/${VALID_UUID}/recover` });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/terms
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/terms', () => {
  void it(
    'returns 200 with terms list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/terms' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { terms: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.terms));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/terms' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/terms/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/terms/:id', () => {
  void it(
    'returns 200 when term exists',
    withSession(async () => {
      setDefaultQueryRows([
        {
          id: VALID_UUID,
          surfaceForm: 'test',
          normalizedForm: 'test',
          domainCode: null,
          pos: 'noun',
          isTechnical: false,
          isProtected: false,
          frequencyScore: 0.5,
          createdAt: new Date().toISOString(),
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/terms/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when term not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/terms/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/terms/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/terms/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/terms/:id', () => {
  void it(
    'returns 200 on valid flags update',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, isTechnical: true, isProtected: false }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/terms/${VALID_UUID}`,
        payload: { isTechnical: true },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when no flags provided',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/terms/${VALID_UUID}`,
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/terms/${INVALID_UUID}`,
        payload: { isTechnical: true },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 404 when term not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/terms/${VALID_UUID}`,
        payload: { isTechnical: true },
      });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/terms/${VALID_UUID}`,
        payload: { isTechnical: true },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/terms/:id/products
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/terms/:id/products', () => {
  void it(
    'returns 404 when term not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/terms/${VALID_UUID}/products` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: `/pim/lex/terms/${INVALID_UUID}/products`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/glossary
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/glossary', () => {
  void it(
    'returns 200 with glossary list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/glossary' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { glossary: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.glossary));
      await app.close();
    })
  );

  void it(
    'returns 400 when q param too long',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: `/pim/lex/glossary?q=${'a'.repeat(201)}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/glossary' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/glossary
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/glossary', () => {
  void it(
    'returns 201 on valid payload',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 1 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/glossary',
        payload: { sourceText: 'salut', targetText: 'hello', sourceLang: 'ro', targetLang: 'en' },
      });
      assert.equal(res.statusCode, 201);
      await app.close();
    })
  );

  void it(
    'returns 400 when sourceText missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/glossary',
        payload: { targetText: 'hello' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when targetText missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/glossary',
        payload: { sourceText: 'salut' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/glossary',
        payload: { sourceText: 'salut', targetText: 'hello' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/glossary/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/glossary/:id', () => {
  void it(
    'returns 200 when glossary entry exists',
    withSession(async () => {
      setDefaultQueryRows([
        { id: VALID_UUID, sourceText: 'salut', targetText: 'hello', version: 1 },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/glossary/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/glossary/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/glossary/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/glossary/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/glossary/:id', () => {
  void it(
    'returns 200 on valid update',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/glossary/${VALID_UUID}`,
        payload: { targetText: 'hi', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/glossary/${INVALID_UUID}`,
        payload: { targetText: 'hi', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 409 for version conflict',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/glossary/${VALID_UUID}`,
        payload: { targetText: 'hi', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 409);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/glossary/${VALID_UUID}`,
        payload: { targetText: 'hi', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /pim/lex/glossary/:id (requires expectedVersion query param)
// ─────────────────────────────────────────────────────────────────────
void describe('DELETE /pim/lex/glossary/:id', () => {
  void it(
    'returns 200 on successful delete',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/glossary/${VALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/glossary/${VALID_UUID}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/glossary/${INVALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/rules
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/rules', () => {
  void it(
    'returns 200 with rules list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/rules' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { rules: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.rules));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/rules' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/rules (requires ruleName, matchTerm, targetTranslation)
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/rules', () => {
  void it(
    'returns 201 on valid payload',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 1 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/rules',
        payload: { ruleName: 'Test Rule', matchTerm: 'seminte', targetTranslation: 'seeds' },
      });
      assert.equal(res.statusCode, 201);
      await app.close();
    })
  );

  void it(
    'returns 400 when required fields missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/rules',
        payload: { ruleName: 'Test Rule' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/rules',
        payload: { ruleName: 'R', matchTerm: 'm', targetTranslation: 't' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/rules/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/rules/:id', () => {
  void it(
    'returns 200 on valid update',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/rules/${VALID_UUID}`,
        payload: { targetTranslation: 'seeds v2', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/rules/${INVALID_UUID}`,
        payload: { targetTranslation: 'seeds v2', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 409 when version conflict',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/rules/${VALID_UUID}`,
        payload: { targetTranslation: 'seeds v2', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 409);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /pim/lex/rules/:id (requires expectedVersion query param)
// ─────────────────────────────────────────────────────────────────────
void describe('DELETE /pim/lex/rules/:id', () => {
  void it(
    'returns 200 on successful delete',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/rules/${VALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/rules/${VALID_UUID}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/rules/${INVALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/profiles
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/profiles', () => {
  void it(
    'returns 200 with profiles list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/profiles' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { profiles: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.profiles));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/profiles' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/profiles (requires domainCode, nameRo)
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/profiles', () => {
  void it(
    'returns 201 on valid payload',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 1 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/profiles',
        payload: { domainCode: 'agriculture', nameRo: 'Agricultură' },
      });
      assert.equal(res.statusCode, 201);
      await app.close();
    })
  );

  void it(
    'returns 400 when required fields missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/profiles',
        payload: { domainCode: 'test' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/profiles',
        payload: { domainCode: 'agri', nameRo: 'Agri' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/profiles/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/profiles/:id', () => {
  void it(
    'returns 200 on valid update',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/profiles/${VALID_UUID}`,
        payload: { nameRo: 'Updated Profile', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/profiles/${INVALID_UUID}`,
        payload: { nameRo: 'Updated', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 409 when version conflict',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/profiles/${VALID_UUID}`,
        payload: { nameRo: 'Updated', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 409);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /pim/lex/profiles/:id (requires expectedVersion query param)
// ─────────────────────────────────────────────────────────────────────
void describe('DELETE /pim/lex/profiles/:id', () => {
  void it(
    'returns 200 on successful delete',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/profiles/${VALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/profiles/${VALID_UUID}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/profiles/${INVALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/stopwords
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/stopwords', () => {
  void it(
    'returns 200 with stopwords list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/stopwords' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { stopwords: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.stopwords));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/stopwords' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/stopwords (requires word)
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/stopwords', () => {
  void it(
    'returns 201 on valid payload',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 1 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/stopwords',
        payload: { word: 'de', locale: 'ro' },
      });
      assert.equal(res.statusCode, 201);
      await app.close();
    })
  );

  void it(
    'returns 400 when word missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/stopwords',
        payload: { locale: 'ro' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/stopwords',
        payload: { word: 'de', locale: 'ro' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/stopwords/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/stopwords/:id', () => {
  void it(
    'returns 200 on valid update',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2, word: 'pe', isActive: true }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/stopwords/${VALID_UUID}`,
        payload: { word: 'pe', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/stopwords/${INVALID_UUID}`,
        payload: { word: 'pe', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 409 when version conflict',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/stopwords/${VALID_UUID}`,
        payload: { word: 'pe', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 409);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /pim/lex/stopwords/:id (requires expectedVersion query param)
// ─────────────────────────────────────────────────────────────────────
void describe('DELETE /pim/lex/stopwords/:id', () => {
  void it(
    'returns 200 on successful delete',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, version: 2 }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/stopwords/${VALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/stopwords/${VALID_UUID}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/pim/lex/stopwords/${INVALID_UUID}?expectedVersion=1`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/review
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/review', () => {
  void it(
    'returns 200 with review items',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/review' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { items: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.items));
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid status',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/review?status=bogus' });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid severity',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/review?severity=bogus' });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid entityType',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/review?entityType=bogus' });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/review' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/review/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/review/:id', () => {
  void it(
    'returns 200 when review item exists',
    withSession(async () => {
      setDefaultQueryRows([
        {
          id: VALID_UUID,
          entityType: 'term',
          entityId: VALID_UUID,
          reviewReason: 'consensus_conflict',
          severity: 'medium',
          priority: 50,
          version: 1,
          status: 'pending',
          notes: null,
          evidence: null,
          assignedTo: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/review/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/review/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/review/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/review/:id/decision
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/review/:id/decision', () => {
  void it(
    'returns 200 on valid decision',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/decision`,
        payload: { decisionType: 'approve', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid decisionType',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/decision`,
        payload: { decisionType: 'bogus', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/decision`,
        payload: { decisionType: 'approve' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${INVALID_UUID}/decision`,
        payload: { decisionType: 'approve', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/decision`,
        payload: { decisionType: 'approve', expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/review/:id/assign
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/review/:id/assign', () => {
  void it(
    'returns 200 on valid assign',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/assign`,
        payload: { expectedVersion: 1, assignedTo: 'staff-2' },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${VALID_UUID}/assign`,
        payload: { assignedTo: 'staff-2' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/review/${INVALID_UUID}/assign`,
        payload: { expectedVersion: 1, assignedTo: 'staff-2' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/review/bulk-decision
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/review/bulk-decision', () => {
  void it(
    'returns 200 on valid bulk decision',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/review/bulk-decision',
        payload: {
          decisions: [{ reviewItemId: VALID_UUID, decisionType: 'approve', expectedVersion: 1 }],
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { totals: { requested: number } } }>();
      assert.equal(body.success, true);
      assert.equal(body.data.totals.requested, 1);
      await app.close();
    })
  );

  void it(
    'returns 400 when decisions is not array',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/review/bulk-decision',
        payload: { decisions: 'not_an_array' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when decisions is empty',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/review/bulk-decision',
        payload: { decisions: [] },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid decisionType in bulk',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/review/bulk-decision',
        payload: {
          decisions: [{ reviewItemId: VALID_UUID, decisionType: 'bogus', expectedVersion: 1 }],
        },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/review/bulk-decision',
        payload: {
          decisions: [{ reviewItemId: VALID_UUID, decisionType: 'approve', expectedVersion: 1 }],
        },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/publications
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/publications', () => {
  void it(
    'returns 200 with publications list',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/publications' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { publications: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.publications));
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid status',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/publications?status=bogus' });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid targetType',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/pim/lex/publications?targetType=bogus',
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when q param too long',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: `/pim/lex/publications?q=${'b'.repeat(201)}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/publications' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/publications/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/publications/:id', () => {
  void it(
    'returns 200 when publication exists',
    withSession(async () => {
      setDefaultQueryRows([
        {
          id: VALID_UUID,
          localizationId: null,
          targetType: 'prod_translations',
          targetRecordId: null,
          targetPath: 'products.title',
          status: 'published',
          attemptCount: 1,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
          payload: {},
          previousSnapshot: {},
          publishedSnapshot: {},
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/publications/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/publications/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/publications/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/publications/:id/retry
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/publications/:id/retry', () => {
  void it(
    'returns 202 on success',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, targetType: 'prod_translations' }]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/retry`,
      });
      assert.equal(res.statusCode, 202);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/retry`,
      });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${INVALID_UUID}/retry`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/retry`,
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/publications/:id/rollback
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/publications/:id/rollback', () => {
  void it(
    'returns 200 on successful rollback',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/rollback`,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${INVALID_UUID}/rollback`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/publications/:id/resolve-conflict
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/publications/:id/resolve-conflict', () => {
  void it(
    'returns 200 on valid resolve',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/resolve-conflict`,
        payload: { resolution: 'accept_lex' },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid resolution',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/resolve-conflict`,
        payload: { resolution: 'bogus' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${INVALID_UUID}/resolve-conflict`,
        payload: { resolution: 'accept_lex' },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/publications/${VALID_UUID}/resolve-conflict`,
        payload: { resolution: 'accept_lex' },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/governance
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/governance', () => {
  void it(
    'returns 201 on valid governance request',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/governance',
        payload: { entityType: 'glossary_entry', payload: { key: 'value' } },
      });
      assert.equal(res.statusCode, 201);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid entity type',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/governance',
        payload: { entityType: 'invalid_entity', payload: {} },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/governance',
        payload: { entityType: 'glossary_entry', payload: {} },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/governance
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/governance', () => {
  void it(
    'returns 200 with governance requests list',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/governance' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { requests: unknown[] } }>();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.requests));
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/governance' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/governance/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/governance/:id', () => {
  void it(
    'returns 200 when governance request exists',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/governance/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/governance/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /pim/lex/governance/:id
// ─────────────────────────────────────────────────────────────────────
void describe('PATCH /pim/lex/governance/:id', () => {
  void it(
    'returns 200 on valid update',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${VALID_UUID}`,
        payload: { payload: { key: 'updated' }, expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when payload missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${VALID_UUID}`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when payload is array',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${VALID_UUID}`,
        payload: { payload: [1, 2, 3], expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when expectedVersion missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${VALID_UUID}`,
        payload: { payload: { key: 'val' } },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${INVALID_UUID}`,
        payload: { payload: { key: 'val' }, expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PATCH',
        url: `/pim/lex/governance/${VALID_UUID}`,
        payload: { payload: { key: 'val' }, expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/governance/:id/cancel, submit, approve, reject, apply
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/governance/:id/cancel', () => {
  void it(
    'returns 200 on cancel',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${VALID_UUID}/cancel`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${INVALID_UUID}/cancel`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('POST /pim/lex/governance/:id/submit', () => {
  void it(
    'returns 200 on submit',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${VALID_UUID}/submit`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${INVALID_UUID}/submit`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('POST /pim/lex/governance/:id/approve', () => {
  void it(
    'returns 200 on approve',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${VALID_UUID}/approve`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${INVALID_UUID}/approve`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('POST /pim/lex/governance/:id/reject', () => {
  void it(
    'returns 200 on reject',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${VALID_UUID}/reject`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${INVALID_UUID}/reject`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('POST /pim/lex/governance/:id/apply', () => {
  void it(
    'returns 200 on apply',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${VALID_UUID}/apply`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: `/pim/lex/governance/${INVALID_UUID}/apply`,
        payload: { expectedVersion: 1 },
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/export
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/export', () => {
  void it(
    'returns CSV for valid entity',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/pim/lex/export?format=csv&entity=terms',
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.toString().includes('text/csv'));
      await app.close();
    })
  );

  void it(
    'returns 400 when format is not csv',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/pim/lex/export?format=json&entity=terms',
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when entity is invalid',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/pim/lex/export?format=csv&entity=bogus',
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 400 when q param too long',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: `/pim/lex/export?format=csv&entity=terms&q=${'c'.repeat(201)}`,
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'GET',
        url: '/pim/lex/export?format=csv&entity=terms',
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/export-xliff
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/export-xliff', () => {
  void it(
    'returns XLIFF XML on valid request',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/export-xliff?targetLang=en' });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.toString().includes('xliff'));
      await app.close();
    })
  );

  void it(
    'returns 400 when targetLang missing',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/export-xliff' });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/export-xliff?targetLang=en' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/import-xliff
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/import-xliff', () => {
  void it(
    'returns 200 on valid XLIFF import',
    withSession(async () => {
      const app = await createApp();
      const xliffBody = `<?xml version="1.0"?><xliff version="2.0" srcLang="ro" trgLang="en"><file><unit id="u1"><segment><source>salut</source><target>hello</target></segment></unit></file></xliff>`;
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/import-xliff',
        headers: { 'content-type': 'text/xml' },
        payload: xliffBody,
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 400 when body is not XLIFF',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/import-xliff',
        headers: { 'content-type': 'text/xml' },
        payload: '<root>not xliff</root>',
      });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/import-xliff',
        headers: { 'content-type': 'text/xml' },
        payload: '<xliff></xliff>',
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/quality-calibration
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/quality-calibration', () => {
  void it(
    'returns 200 with calibration data',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/quality-calibration' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { calibration: unknown } }>();
      assert.equal(body.success, true);
      assert.ok(body.data.calibration);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/quality-calibration' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/tm-stats
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/tm-stats', () => {
  void it(
    'returns 200 with TM stats',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/tm-stats' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{
        success: boolean;
        data: { hitRate: number; tmHits: number; tmMisses: number };
      }>();
      assert.equal(body.success, true);
      assert.equal(body.data.tmHits, 50);
      assert.equal(body.data.tmMisses, 10);
      assert.equal(body.data.hitRate, 83.3);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/tm-stats' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/bootstrap
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/bootstrap', () => {
  void it(
    'returns 200 with bootstrap data',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/bootstrap' });
      assert.equal(res.statusCode, 200);
      const body = res.json<{ success: boolean; data: { bootstrap: { enabled: boolean } } }>();
      assert.equal(body.success, true);
      assert.ok(body.data.bootstrap);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/pim/lex/bootstrap' });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// POST /pim/lex/queues/:queueName/retry-dlq
// ─────────────────────────────────────────────────────────────────────
void describe('POST /pim/lex/queues/:queueName/retry-dlq', () => {
  void it(
    'returns 200 on valid queue name',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/queues/lex-extract-fragments/retry-dlq',
      });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 401 without session',
    withoutSession(async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'POST',
        url: '/pim/lex/queues/lex-extract-fragments/retry-dlq',
      });
      assert.equal(res.statusCode, 401);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/clusters/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/clusters/:id', () => {
  void it(
    'returns 200 when cluster exists',
    withSession(async () => {
      setDefaultQueryRows([
        {
          id: VALID_UUID,
          label: 'Cluster A',
          canonicalTermId: VALID_UUID,
          memberCount: 3,
          createdAt: new Date().toISOString(),
        },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/clusters/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when cluster not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/clusters/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/clusters/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

// ─────────────────────────────────────────────────────────────────────
// GET /pim/lex/rules/:id, profiles/:id, stopwords/:id
// ─────────────────────────────────────────────────────────────────────
void describe('GET /pim/lex/rules/:id', () => {
  void it(
    'returns 200 when rule exists',
    withSession(async () => {
      setDefaultQueryRows([
        { id: VALID_UUID, ruleType: 'substitution', matchPattern: 'test', version: 1 },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/rules/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/rules/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/rules/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('GET /pim/lex/profiles/:id', () => {
  void it(
    'returns 200 when profile exists',
    withSession(async () => {
      setDefaultQueryRows([
        { id: VALID_UUID, domainCode: 'agriculture', nameRo: 'Agri', version: 1 },
      ]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/profiles/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/profiles/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/profiles/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});

void describe('GET /pim/lex/stopwords/:id', () => {
  void it(
    'returns 200 when stopword exists',
    withSession(async () => {
      setDefaultQueryRows([{ id: VALID_UUID, word: 'de', locale: 'ro', version: 1 }]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/stopwords/${VALID_UUID}` });
      assert.equal(res.statusCode, 200);
      await app.close();
    })
  );

  void it(
    'returns 404 when not found',
    withSession(async () => {
      setDefaultQueryRows([]);
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/stopwords/${VALID_UUID}` });
      assert.equal(res.statusCode, 404);
      await app.close();
    })
  );

  void it(
    'returns 400 for invalid UUID',
    withSession(async () => {
      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: `/pim/lex/stopwords/${INVALID_UUID}` });
      assert.equal(res.statusCode, 400);
      await app.close();
    })
  );
});
