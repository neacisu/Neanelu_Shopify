import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const sessionPath = new URL('../../../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession:
      () =>
      (request: { session?: Record<string, unknown> }, _reply: unknown): void => {
        request.session = {
          shopId: 'integration-shop',
          shopDomain: 'integration.myshopify.com',
          staffUserId: 'staff-1',
          staffEmail: 'staff@example.com',
          createdAt: Date.now(),
        };
      },
  },
});

const accessPath = new URL('../../../../auth/require-lex-access.js', import.meta.url).href;
void mock.module(accessPath, {
  namedExports: {
    requireLexModuleAccess:
      () =>
      (request: { lexAccess?: Record<string, unknown> }, _reply: unknown): void => {
        request.lexAccess = {
          moduleEnabled: true,
          reviewUiEnabled: true,
          collectionAdapterEnabled: true,
          shopEnabled: true,
          isAdmin: true,
          permissions: {
            canView: true,
            canReview: true,
            canPublish: true,
            canManageSettings: true,
          },
          settingsSummary: {
            shopId: 'integration-shop',
            version: 7,
            enabled: true,
            sourceLang: 'ro',
            targetLangs: ['en'],
            shardSize: 10_000,
            autoPublishProducts: false,
            autoPublishAttributes: false,
            autoPublishCollections: false,
          },
        };
      },
    requireLexReviewAccess:
      () =>
      (request: { lexAccess?: Record<string, unknown> }, _reply: unknown): void => {
        request.lexAccess = {
          permissions: {
            canView: true,
            canReview: true,
            canPublish: true,
            canManageSettings: true,
          },
        };
      },
    requireLexPublishAccess:
      () =>
      (request: { lexAccess?: Record<string, unknown> }, _reply: unknown): void => {
        request.lexAccess = {
          permissions: {
            canView: true,
            canReview: true,
            canPublish: true,
            canManageSettings: true,
          },
        };
      },
    resolveLexBootstrap: () => ({
      moduleEnabled: true,
      reviewUiEnabled: true,
      collectionAdapterEnabled: true,
      shopEnabled: true,
      isAdmin: true,
      permissions: {
        canView: true,
        canReview: true,
        canPublish: true,
        canManageSettings: true,
      },
      settingsSummary: {
        shopId: 'integration-shop',
        version: 7,
        enabled: true,
        sourceLang: 'ro',
        targetLangs: ['en'],
        shardSize: 10_000,
        autoPublishProducts: false,
        autoPublishAttributes: false,
        autoPublishCollections: false,
      },
    }),
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      cb: (client: {
        query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          params?: unknown[]
        ) => Promise<{ rows: TRow[] }>;
      }) => Promise<unknown>
    ) =>
      await cb({
        query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
          sql: string
        ): Promise<{ rows: TRow[] }> => {
          if (sql.includes('FROM lex_publication_targets')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'pub-1',
                  localizationId: 'loc-1',
                  targetType: 'prod_translations',
                  targetRecordId: 'prod-1',
                  targetPath: null,
                  status: 'published',
                  attemptCount: 2,
                  errorMessage: null,
                  updatedAt: '2026-03-15T11:00:00.000Z',
                  payload: { locale: 'en' },
                  previousSnapshot: {
                    exists: true,
                    rowId: 'prod-1',
                    locale: 'en',
                    title: 'Valve body',
                    description: 'Original description',
                    description_short: 'Original short',
                    keywords: ['valve'],
                    seo_title: 'Original SEO',
                    seo_description: 'Original SEO description',
                    translation_source: 'lexical',
                    quality_score: 0.91,
                    is_approved: true,
                  },
                  publishedSnapshot: {
                    exists: true,
                    rowId: 'prod-1',
                    locale: 'en',
                    title: 'Valve body localized',
                    description: 'Localized description',
                  },
                } as unknown as TRow,
              ],
            });
          }

          if (sql.includes('FROM lex_publish_events')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'evt-1',
                  action: 'update',
                  status: 'published',
                  errorMessage: null,
                  createdAt: '2026-03-15T11:00:00.000Z',
                  requestPayload: { title: 'Valve body localized' },
                  responsePayload: { updated: true },
                } as unknown as TRow,
              ],
            });
          }

          return Promise.resolve({ rows: [] as TRow[] });
        },
      }),
    logAuditEvent: () => undefined,
  },
});

const queuePath = new URL('../../../../queue/lex-queues.js', import.meta.url).href;
void mock.module(queuePath, {
  namedExports: {
    enqueueLexPublishJob: () => 'lex-publish-job-1',
    enqueueLexRunRequestedJob: () => 'lex-run-job-1',
  },
});

const scheduledTasksPath = new URL('../../../../processors/lex/scheduled-tasks.js', import.meta.url)
  .href;
void mock.module(scheduledTasksPath, {
  namedExports: {
    reconcileLexScheduledTasks: () => undefined,
  },
});

const governancePath = new URL('../../../../services/lex-governance.js', import.meta.url).href;
void mock.module(governancePath, {
  namedExports: {
    approveLexGovernanceRequest: () => null,
    applyLexGovernanceRequest: () => null,
    createLexGovernanceRequest: () => null,
    getLexGovernanceRequest: () => null,
    listLexGovernanceRequests: () => [],
    rejectLexGovernanceRequest: () => null,
    submitLexGovernanceRequest: () => null,
  },
});

const reviewActionsPath = new URL('../../../../services/lex-review-actions.js', import.meta.url)
  .href;
void mock.module(reviewActionsPath, {
  namedExports: {
    assignLexReviewItem: () => null,
    decideLexReviewItem: () => null,
  },
});

const lexOpsPath = new URL('../../../../services/lex-ops.js', import.meta.url).href;
void mock.module(lexOpsPath, {
  namedExports: {
    collectLexMetrics: () => ({
      runsTotal: 30,
      termsTotal: 120,
      clustersTotal: 25,
      glossaryTotal: 8,
      reviewPending: 2,
      reviewBacklog: 4,
      localizationsApproved: 11,
      publicationsPending: 3,
      runsActive: 2,
      runsPaused: 1,
      pausedBudgetBlocked: 1,
      pausedProviderUnavailable: 0,
      shardsFailed: 1,
      publicationsFailed: 1,
      publishConflicts: 1,
      staleCheckpoints: 2,
      retentionLag: 3600,
      aiBatchBacklog: 3,
      dlqEntries: 2,
      workersOnline: 11,
      workersTotal: 12,
      workers: [],
      queues: [],
      alerts: [],
    }),
    buildLexPublicationQueueLinks: () => ({
      queueName: 'lex.publish',
      queueUrl: '/queues?tab=jobs&queue=lex.publish',
      dlqQueueName: 'lex.publish-dlq',
      dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
      overviewUrl: '/queues?tab=overview',
    }),
  },
});

const lexLocalizationsPath = new URL('../../../../services/lex-localizations.js', import.meta.url)
  .href;
void mock.module(lexLocalizationsPath, {
  namedExports: {
    getLexPublicationRollbackStatus: () => ({
      rollbackable: true,
      rollbackBlockedReason: null,
      snapshotCompleteness: 'complete',
      needsRepair: false,
    }),
    rollbackLexPublicationTarget: () => 'rolled_back',
  },
});

void describe('integration: lexical operator surface', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const module = await import('../../../../routes/pim-lex.js');
    const pimLexRoutes = (module as { pimLexRoutes: unknown }).pimLexRoutes;

    app = Fastify();
    await app.register(
      pimLexRoutes as never,
      {
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test', redisPrefix: '' },
        logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );
  });

  afterEach(async () => {
    await app.close();
  });

  void test('GET /pim/lex/metrics returns aligned lexical operator metrics', async () => {
    const response = await app.inject({ method: 'GET', url: '/pim/lex/metrics' });
    assert.equal(response.statusCode, 200);
    const body = response.json<{
      success: boolean;
      data: { metrics: { runsActive: number; pausedBudgetBlocked: number; dlqEntries: number } };
    }>();

    assert.equal(body.success, true);
    assert.equal(body.data.metrics.runsActive, 2);
    assert.equal(body.data.metrics.pausedBudgetBlocked, 1);
    assert.equal(body.data.metrics.dlqEntries, 2);
  });

  void test('GET /pim/lex/publications/:id returns rollback verdict and queue links', async () => {
    const response = await app.inject({ method: 'GET', url: '/pim/lex/publications/pub-1' });
    assert.equal(response.statusCode, 200);
    const body = response.json<{
      success: boolean;
      data: {
        publication: {
          id: string;
          rollbackable: boolean;
          snapshotCompleteness: string;
          queueLinks: { queueUrl: string; dlqUrl: string };
          events: { id: string }[];
        };
      };
    }>();

    assert.equal(body.success, true);
    assert.equal(body.data.publication.id, 'pub-1');
    assert.equal(body.data.publication.rollbackable, true);
    assert.equal(body.data.publication.snapshotCompleteness, 'complete');
    assert.equal(body.data.publication.queueLinks.queueUrl, '/queues?tab=jobs&queue=lex.publish');
    assert.equal(body.data.publication.queueLinks.dlqUrl, '/queues?tab=jobs&queue=lex.publish-dlq');
    assert.equal(body.data.publication.events.length, 1);
  });
});
