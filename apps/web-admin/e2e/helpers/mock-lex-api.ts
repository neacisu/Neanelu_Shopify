import type { Page, Route } from '@playwright/test';

interface Envelope<T> {
  success: true;
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
  };
}

type MockCall = Readonly<{
  method: string;
  path: string;
  body: unknown;
}>;

type GovernanceStatus = 'draft' | 'pending_approval' | 'approved' | 'applied';
type ReviewStatus = 'open' | 'approved' | 'rejected';
type PublicationStatus = 'published' | 'pending' | 'rolled_back';

export interface LexApiMockState {
  calls: MockCall[];
  governanceRequests: {
    id: string;
    entityType: string;
    requestScope: string;
    title: string;
    status: GovernanceStatus;
    version: number;
    createdAt: string;
    submittedAt: string | null;
  }[];
  reviewItems: {
    id: string;
    entityType: string;
    entityId: string;
    reviewReason: string;
    severity: string;
    priority: number;
    status: ReviewStatus;
    version: number;
  }[];
  reviewDetail: {
    id: string;
    entityType: string;
    entityId: string;
    reviewReason: string;
    severity: string;
    priority: number;
    status: ReviewStatus;
    evidence: Record<string, unknown>;
    decisions: {
      id: string;
      decisionType: string;
      decisionNotes: string | null;
      decidedBy: string | null;
      createdAt: string | null;
      oldValue: Record<string, unknown>;
      newValue: Record<string, unknown>;
    }[];
    timeline: {
      id: string;
      kind: 'decision' | 'publish_event' | 'governance_event' | 'run_phase';
      action: string;
      status: string | null;
      actorId: string | null;
      createdAt: string | null;
      details: Record<string, unknown>;
    }[];
    relatedLocalizations: Record<string, unknown>[];
    relatedPublications: Record<string, unknown>[];
  };
  publications: {
    id: string;
    targetType: string;
    targetRecordId: string | null;
    targetPath: string | null;
    status: PublicationStatus;
    attemptCount: number;
    errorMessage: string | null;
    updatedAt: string;
  }[];
  publicationDetail: {
    id: string;
    localizationId: string | null;
    targetType: string;
    targetRecordId: string | null;
    targetPath: string | null;
    status: PublicationStatus;
    attemptCount: number;
    errorMessage: string | null;
    updatedAt: string;
    payload: Record<string, unknown>;
    previousSnapshot: Record<string, unknown>;
    publishedSnapshot: Record<string, unknown>;
    rollbackable: boolean;
    rollbackBlockedReason: string | null;
    snapshotCompleteness: 'complete' | 'repairable' | 'blocked';
    needsRepair: boolean;
    queueLinks: {
      queueName: string;
      queueUrl: string;
      dlqQueueName: string;
      dlqUrl: string;
    };
    events: {
      id: string;
      action: string;
      status: string;
      errorMessage: string | null;
      createdAt: string | null;
      requestPayload: Record<string, unknown>;
      responsePayload: Record<string, unknown>;
    }[];
  };
}

function nowIso(): string {
  return new Date('2026-03-15T12:00:00.000Z').toISOString();
}

function envelope<T>(data: T): Envelope<T> {
  return {
    success: true,
    data,
    meta: {
      request_id: 'playwright-request',
      timestamp: nowIso(),
    },
  };
}

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

function readJsonBody(route: Route): unknown {
  const raw = route.request().postData();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Context per request pentru mock-ul API Lex (E2E); permite dispatch în lanț, fără ramificări monolitice. */
interface MockRouteContext {
  readonly route: Route;
  readonly path: string;
  readonly method: string;
  readonly url: URL;
  readonly state: LexApiMockState;
  readonly body: unknown;
}

function parseDashboardDays(url: URL): number {
  return Number.parseInt(url.searchParams.get('days') ?? '7', 10);
}

function applyGovernanceWorkflowAction(
  record: LexApiMockState['governanceRequests'][number],
  action: string | undefined
): void {
  record.version += 1;
  if (action === 'submit') {
    record.status = 'pending_approval';
    record.submittedAt = nowIso();
    return;
  }
  if (action === 'approve') {
    record.status = 'approved';
    return;
  }
  if (action === 'apply') {
    record.status = 'applied';
  }
}

function bumpMockPublicationToPending(state: LexApiMockState): void {
  state.publications[0] = {
    ...state.publications[0]!,
    status: 'pending',
    attemptCount: state.publications[0]!.attemptCount + 1,
    updatedAt: nowIso(),
  };
  state.publicationDetail = {
    ...state.publicationDetail,
    status: 'pending',
    attemptCount: state.publicationDetail.attemptCount + 1,
    updatedAt: nowIso(),
  };
}

function applyMockPublicationRollback(state: LexApiMockState): void {
  state.publications[0] = {
    ...state.publications[0]!,
    status: 'rolled_back',
    updatedAt: nowIso(),
  };
  state.publicationDetail = {
    ...state.publicationDetail,
    status: 'rolled_back',
    rollbackable: false,
    rollbackBlockedReason: 'already_rolled_back',
    updatedAt: nowIso(),
  };
}

function buildMockLexMetricsBlock(state: LexApiMockState): Record<string, unknown> {
  return {
    runsTotal: 15,
    termsTotal: 220,
    clustersTotal: 40,
    glossaryTotal: 12,
    reviewPending: 1,
    reviewBacklog: 4,
    localizationsApproved: 9,
    publicationsPending: state.publications.filter((item) => item.status === 'pending').length,
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
    tmHits: 8,
    tmMisses: 2,
    tmHitRatePercent: 80,
    tmMissRatePercent: 20,
    tmAverageSimilarity: 0.945,
    dlqEntries: 2,
    workersOnline: 11,
    workersTotal: 12,
    alerts: [
      {
        key: 'lex-dlq-present',
        severity: 'critical',
        message: 'Există job-uri lex în DLQ.',
        href: '/queues?tab=jobs&queue=lex.publish-dlq',
        queueName: 'lex.publish-dlq',
        workerId: null,
      },
    ],
    workers: [
      {
        id: 'lex-publish-worker',
        label: 'Lex Publish',
        ok: true,
        queueName: 'lex.publish',
        queueUrl: '/queues?tab=jobs&queue=lex.publish',
        dlqQueueName: 'lex.publish-dlq',
        dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
        currentJob: null,
      },
    ],
    queues: [
      {
        name: 'lex.publish',
        waiting: 2,
        active: 1,
        delayed: 0,
        failed: 0,
        completed: 5,
        dlqEntries: 2,
        queueUrl: '/queues?tab=jobs&queue=lex.publish',
        dlqQueueName: 'lex.publish-dlq',
        dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
      },
    ],
  };
}

function applyMockReviewDecision(
  state: LexApiMockState,
  decisionType: string,
  notes: string | null
): void {
  const nextReviewStatus: ReviewStatus = decisionType === 'reject' ? 'rejected' : 'approved';
  state.reviewItems[0] = {
    ...state.reviewItems[0]!,
    status: nextReviewStatus,
    version: state.reviewItems[0]!.version + 1,
  };
  state.reviewDetail = {
    ...state.reviewDetail,
    status: nextReviewStatus,
    decisions: [
      {
        id: `decision-${state.reviewDetail.decisions.length + 1}`,
        decisionType,
        decisionNotes: notes,
        decidedBy: 'staff-1',
        createdAt: nowIso(),
        oldValue: {},
        newValue: { status: nextReviewStatus },
      },
      ...state.reviewDetail.decisions,
    ],
  };

  if (decisionType === 'publish') {
    bumpMockPublicationToPending(state);
  }
}

type MockLexRouteHandler = (ctx: MockRouteContext) => Promise<boolean>;

async function mockLexSessionToken(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.path !== '/session/token' || ctx.method !== 'GET') return false;
  await json(
    ctx.route,
    envelope({
      token: 'mock-cookie-token',
      expiresAt: '2026-03-15T13:00:00.000Z',
    })
  );
  return true;
}

async function mockLexDashboardRoutes(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/dashboard/summary') {
    await json(
      ctx.route,
      envelope({
        totalProducts: 1200,
        activeBulkRuns: 2,
        apiErrorRate: 0.01,
        apiLatencyP95Ms: 180,
        goldenRate: 0.62,
        goldenCount: 744,
        avgQualityScore: 0.84,
        queueBacklog: 14,
        enrichmentSuccessRate: 0.93,
        todayAiCost: 28.5,
        todayWebhooks: 94,
        attentionProducts: 12,
        lastSyncAt: '2026-03-15T10:00:00.000Z',
        lex: {
          activeRuns: 2,
          pausedRuns: 1,
          failedShards: 1,
          staleCheckpoints: 2,
          aiBatchBacklog: 3,
          reviewBacklog: 4,
          pendingPublications: 3,
          failedPublications: 1,
          publishConflicts: 1,
          dlqEntries: 2,
          retentionLagSeconds: 3600,
          workersOnline: 11,
          workersTotal: 12,
        },
      })
    );
    return true;
  }

  if (ctx.path === '/dashboard/alerts') {
    await json(
      ctx.route,
      envelope({
        alerts: [
          {
            id: 'lex_dlq_present',
            severity: 'critical',
            title: 'Lex DLQ activ',
            description: 'Există job-uri lex în Dead Letter Queue.',
            href: '/queues?tab=jobs&queue=lex.publish-dlq',
          },
        ],
      })
    );
    return true;
  }

  if (ctx.path === '/dashboard/health-score') {
    await json(
      ctx.route,
      envelope({
        score: 82,
        status: 'healthy',
        components: {
          redis: { score: 100 },
          errorRate: { score: 96 },
          latency: { score: 86 },
          backlog: { score: 80 },
          lex: {
            score: 73,
            workersOnline: 11,
            workersTotal: 12,
            pausedRuns: 1,
            pausedBudgetBlocked: 1,
            pausedProviderUnavailable: 0,
            staleCheckpoints: 2,
            dlqEntries: 2,
            publicationFailures: 1,
            publishConflicts: 1,
            retentionLagSeconds: 3600,
          },
        },
      })
    );
    return true;
  }

  if (ctx.path === '/dashboard/activity') {
    const days = parseDashboardDays(ctx.url);
    await json(
      ctx.route,
      envelope({
        days,
        points: Array.from({ length: days }).map((_, index) => ({
          date: `2026-03-${String(index + 1).padStart(2, '0')}`,
          total: 20 + index,
          breakdown: {
            sync: 8,
            webhook: 6,
            bulk: 4,
            aiBatch: 2,
          },
        })),
      })
    );
    return true;
  }

  if (ctx.path === '/dashboard/summary/trend') {
    const days = parseDashboardDays(ctx.url);
    await json(
      ctx.route,
      envelope({
        days,
        points: Array.from({ length: days }).map((_, index) => ({
          date: `2026-03-${String(index + 1).padStart(2, '0')}`,
          totalProducts: 1000 + index,
          queueBacklog: 10 + (index % 4),
          goldenRate: 0.6 + index * 0.001,
          avgQualityScore: 0.8 + index * 0.001,
          apiErrorRate: 0.01,
          apiLatencyP95Ms: 180,
          enrichmentSuccessRate: 0.93,
          todayAiCost: 20 + index,
          attentionProducts: 12 - Math.min(index, 6),
        })),
      })
    );
    return true;
  }

  return false;
}

async function mockLexQueueRoutes(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/queues') {
    await json(
      ctx.route,
      envelope({
        queues: [
          {
            name: 'lex.publish',
            waiting: 2,
            active: 1,
            completed: 5,
            failed: 0,
            delayed: 0,
            counts: {
              waiting: 2,
              active: 1,
              completed: 5,
              failed: 0,
              delayed: 0,
            },
          },
        ],
      })
    );
    return true;
  }

  if (ctx.path === '/queues/lex.publish/metrics') {
    await json(
      ctx.route,
      envelope({
        points: [
          {
            timestamp: '2026-03-15T10:00:00.000Z',
            waiting: 2,
            active: 1,
            failed: 0,
            completed: 4,
          },
          {
            timestamp: '2026-03-15T10:05:00.000Z',
            waiting: 1,
            active: 1,
            failed: 0,
            completed: 5,
          },
        ],
      })
    );
    return true;
  }

  if (ctx.path === '/queues/lex.publish-dlq/metrics') {
    await json(
      ctx.route,
      envelope({
        points: [
          {
            timestamp: '2026-03-15T10:00:00.000Z',
            waiting: 1,
            active: 0,
            failed: 1,
            completed: 0,
          },
        ],
      })
    );
    return true;
  }

  if (ctx.path.startsWith('/queues/') && ctx.path.endsWith('/jobs')) {
    await json(ctx.route, envelope({ jobs: [], total: 0 }));
    return true;
  }

  if (ctx.path === '/queues/workers') {
    await json(ctx.route, envelope({ workers: [] }));
    return true;
  }

  return false;
}

async function mockLexBulkRoutes(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;
  if (ctx.path === '/bulk/current') {
    await json(ctx.route, envelope(null));
    return true;
  }
  if (ctx.path === '/bulk') {
    await json(ctx.route, envelope({ runs: [] }));
    return true;
  }
  return false;
}

async function mockLexPimStatsRoutes(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;
  if (ctx.path === '/pim/stats/quality-distribution') {
    await json(ctx.route, envelope({ golden: 744, silver: 240, bronze: 120, review: 96 }));
    return true;
  }
  if (ctx.path === '/pim/stats/cost-tracking') {
    await json(ctx.route, envelope({ todayCost: 28.5 }));
    return true;
  }
  if (ctx.path === '/pim/stats/enrichment-progress') {
    await json(ctx.route, envelope({ attentionProducts: 12, enrichmentRate: 0.93 }));
    return true;
  }
  return false;
}

async function mockLexPimLexBootstrapAndSettings(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/pim/lex/bootstrap') {
    await json(
      ctx.route,
      envelope({
        bootstrap: {
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
            canGovernance: true,
          },
          settingsSummary: {
            shopId: 'shop-1',
            version: 3,
            enabled: true,
            sourceLang: 'ro',
            targetLangs: ['en'],
            shardSize: 10_000,
            autoPublishProducts: false,
            autoPublishAttributes: false,
            autoPublishCollections: false,
          },
        },
      })
    );
    return true;
  }

  if (ctx.path === '/pim/lex/settings') {
    await json(
      ctx.route,
      envelope({
        settings: {
          shopId: 'shop-1',
          version: 3,
          enabled: true,
          sourceLang: 'ro',
          targetLangs: ['en'],
          extractScope: {},
          shardSize: 10_000,
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
      })
    );
    return true;
  }

  return false;
}

async function mockLexPimLexMetricsRunsLocalizations(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/pim/lex/metrics') {
    await json(ctx.route, envelope({ metrics: buildMockLexMetricsBlock(ctx.state) }));
    return true;
  }

  if (ctx.path === '/pim/lex/runs') {
    await json(
      ctx.route,
      envelope({
        runs: [
          {
            id: 'run-1',
            shopId: 'shop-1',
            runType: 'delta_rebuild',
            status: 'running',
            pauseReason: null,
            currentPhase: 'publish',
            startedAt: '2026-03-15T10:00:00.000Z',
            completedAt: null,
            fragmentsCount: 12,
            occurrencesCount: 42,
            termsCount: 21,
            contextsCount: 14,
            senseClustersCount: 5,
            translationsCount: 8,
            aiBatchesCount: 2,
            errorMessage: null,
            metadata: {},
          },
        ],
        page: { items: [], nextCursor: null },
      })
    );
    return true;
  }

  if (ctx.path === '/pim/lex/localizations') {
    await json(
      ctx.route,
      envelope({
        localizations: [
          {
            id: 'loc-1',
            entityType: 'product',
            entityId: 'prod-1',
            sourceLang: 'ro',
            targetLang: 'en',
            titleText: 'Valve body',
            descriptionText: 'Localized description',
            descriptionShort: 'Localized short',
            seoTitle: 'SEO title',
            seoDescription: 'SEO description',
            keywords: ['valve'],
            version: 1,
            qualityScore: 0.98,
            publicationStatus: 'approved',
            approvedAt: '2026-03-15T10:00:00.000Z',
          },
        ],
        page: { items: [], nextCursor: null },
      })
    );
    return true;
  }

  return false;
}

async function mockLexPimLexReviewAndLexResources(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/pim/lex/review') {
    await json(
      ctx.route,
      envelope({ items: ctx.state.reviewItems, page: { items: [], nextCursor: null } })
    );
    return true;
  }
  if (ctx.path === '/pim/lex/review/review-1') {
    await json(ctx.route, envelope({ review: ctx.state.reviewDetail }));
    return true;
  }
  if (ctx.path === '/pim/lex/glossary') {
    await json(ctx.route, envelope({ glossary: [] }));
    return true;
  }
  if (ctx.path === '/pim/lex/rules') {
    await json(ctx.route, envelope({ rules: [] }));
    return true;
  }
  if (ctx.path === '/pim/lex/profiles') {
    await json(ctx.route, envelope({ profiles: [] }));
    return true;
  }
  if (ctx.path === '/pim/lex/stopwords') {
    await json(ctx.route, envelope({ stopwords: [] }));
    return true;
  }

  return false;
}

async function mockLexPimLexGovernanceAndPublicationsRead(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.method !== 'GET') return false;

  if (ctx.path === '/pim/lex/governance') {
    await json(ctx.route, envelope({ requests: ctx.state.governanceRequests }));
    return true;
  }
  if (ctx.path === '/pim/lex/publications') {
    await json(
      ctx.route,
      envelope({
        publications: ctx.state.publications,
        page: { items: [], nextCursor: null },
      })
    );
    return true;
  }
  if (ctx.path === '/pim/lex/publications/pub-1') {
    await json(ctx.route, envelope({ publication: ctx.state.publicationDetail }));
    return true;
  }

  return false;
}

async function mockLexGovernanceCreatePost(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.path !== '/pim/lex/governance' || ctx.method !== 'POST') return false;
  const nextId = `gov-${ctx.state.governanceRequests.length + 1}`;
  const payload = (ctx.body ?? {}) as { entityType?: string; title?: string };
  ctx.state.governanceRequests.unshift({
    id: nextId,
    entityType: payload.entityType ?? 'glossary_entry',
    requestScope: 'global',
    title: payload.title ?? nextId,
    status: 'draft',
    version: 1,
    createdAt: nowIso(),
    submittedAt: null,
  });
  await json(ctx.route, envelope({ requestId: nextId }));
  return true;
}

async function mockLexGovernanceActionPost(ctx: MockRouteContext): Promise<boolean> {
  if (!ctx.path.startsWith('/pim/lex/governance/') || ctx.method !== 'POST') return false;
  const segments = ctx.path.split('/').filter(Boolean);
  const requestId = segments[3];
  const action = segments[4];
  const requestRecord = ctx.state.governanceRequests.find((item) => item.id === requestId);
  if (requestRecord) {
    applyGovernanceWorkflowAction(requestRecord, action);
  }
  await json(ctx.route, envelope({ requestId, action }));
  return true;
}

async function mockLexReviewDecisionPost(ctx: MockRouteContext): Promise<boolean> {
  if (!ctx.path.startsWith('/pim/lex/review/review-1/decision') || ctx.method !== 'POST') {
    return false;
  }
  const payload = (ctx.body ?? {}) as { decisionType?: string; notes?: unknown };
  const decisionType = payload.decisionType ?? 'approve';
  const notes = typeof payload.notes === 'string' ? payload.notes : null;
  applyMockReviewDecision(ctx.state, decisionType, notes);
  await json(ctx.route, envelope({ reviewId: 'review-1', decisionType }));
  return true;
}

async function mockLexPublicationRetryPost(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.path !== '/pim/lex/publications/pub-1/retry' || ctx.method !== 'POST') return false;
  bumpMockPublicationToPending(ctx.state);
  await json(ctx.route, envelope({ publicationTargetId: 'pub-1', result: 'queued' }), 202);
  return true;
}

async function mockLexPublicationRollbackPost(ctx: MockRouteContext): Promise<boolean> {
  if (ctx.path !== '/pim/lex/publications/pub-1/rollback' || ctx.method !== 'POST') return false;
  applyMockPublicationRollback(ctx.state);
  await json(ctx.route, envelope({ publicationTargetId: 'pub-1', result: 'rolled_back' }));
  return true;
}

/**
 * Lanț de handler-e în ordinea de potrivire a rutelor (mai specifice / POST-uri după GET-uri acolo unde contează).
 * Fiecare handler întoarce true dacă a răspuns la request.
 */
const MOCK_LEX_API_ROUTE_HANDLERS: readonly MockLexRouteHandler[] = [
  mockLexSessionToken,
  mockLexDashboardRoutes,
  mockLexQueueRoutes,
  mockLexBulkRoutes,
  mockLexPimStatsRoutes,
  mockLexPimLexBootstrapAndSettings,
  mockLexPimLexMetricsRunsLocalizations,
  mockLexPimLexReviewAndLexResources,
  mockLexPimLexGovernanceAndPublicationsRead,
  mockLexGovernanceCreatePost,
  mockLexGovernanceActionPost,
  mockLexReviewDecisionPost,
  mockLexPublicationRetryPost,
  mockLexPublicationRollbackPost,
];

async function dispatchMockLexApiRoute(ctx: MockRouteContext): Promise<void> {
  for (const handler of MOCK_LEX_API_ROUTE_HANDLERS) {
    if (await handler(ctx)) return;
  }
  await json(ctx.route, envelope({ ok: true }));
}

export async function installLexApiMocks(page: Page): Promise<LexApiMockState> {
  const queueLinks = {
    queueName: 'lex.publish',
    queueUrl: '/queues?tab=jobs&queue=lex.publish',
    dlqQueueName: 'lex.publish-dlq',
    dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
  } as const;

  const state: LexApiMockState = {
    calls: [],
    governanceRequests: [
      {
        id: 'gov-1',
        entityType: 'glossary_entry',
        requestScope: 'global',
        title: 'Promote valve canon',
        status: 'draft',
        version: 3,
        createdAt: '2026-03-15T09:00:00.000Z',
        submittedAt: null,
      },
    ],
    reviewItems: [
      {
        id: 'review-1',
        entityType: 'translation',
        entityId: 'term-1',
        reviewReason: 'low_confidence',
        severity: 'warning',
        priority: 70,
        status: 'open',
        version: 4,
      },
    ],
    reviewDetail: {
      id: 'review-1',
      entityType: 'translation',
      entityId: 'term-1',
      reviewReason: 'low_confidence',
      severity: 'warning',
      priority: 70,
      status: 'open',
      evidence: { candidate: 'Valve body', confidence: 0.68 },
      decisions: [],
      timeline: [],
      relatedLocalizations: [
        {
          id: 'loc-1',
          entityType: 'product',
          entityId: 'prod-1',
          targetLang: 'en',
          publicationStatus: 'approved',
          qualityScore: 0.94,
        },
      ],
      relatedPublications: [
        {
          id: 'pub-1',
          targetType: 'prod_translations',
          targetRecordId: 'prod-1',
          targetPath: null,
          status: 'published',
          attemptCount: 2,
          errorMessage: null,
          updatedAt: '2026-03-15T11:00:00.000Z',
        },
      ],
    },
    publications: [
      {
        id: 'pub-1',
        targetType: 'prod_translations',
        targetRecordId: 'prod-1',
        targetPath: null,
        status: 'published',
        attemptCount: 2,
        errorMessage: null,
        updatedAt: '2026-03-15T11:00:00.000Z',
      },
    ],
    publicationDetail: {
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
      },
      publishedSnapshot: {
        exists: true,
        rowId: 'prod-1',
        locale: 'en',
        title: 'Valve body localized',
        description: 'Localized description',
      },
      rollbackable: true,
      rollbackBlockedReason: null,
      snapshotCompleteness: 'complete',
      needsRepair: false,
      queueLinks,
      events: [
        {
          id: 'evt-1',
          action: 'update',
          status: 'published',
          errorMessage: null,
          createdAt: '2026-03-15T11:00:00.000Z',
          requestPayload: { title: 'Valve body localized' },
          responsePayload: { updated: true },
        },
      ],
    },
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method().toUpperCase();
    const body = readJsonBody(route);

    state.calls.push({ method, path, body });
    await dispatchMockLexApiRoute({ route, path, method, url, state, body });
  });

  return state;
}
