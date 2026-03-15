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

    if (path === '/session/token' && method === 'GET') {
      return json(
        route,
        envelope({
          token: 'mock-cookie-token',
          expiresAt: '2026-03-15T13:00:00.000Z',
        })
      );
    }

    if (path === '/dashboard/summary' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/dashboard/alerts' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/dashboard/health-score' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/dashboard/activity' && method === 'GET') {
      const days = Number.parseInt(url.searchParams.get('days') ?? '7', 10);
      return json(
        route,
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
    }

    if (path === '/dashboard/summary/trend' && method === 'GET') {
      const days = Number.parseInt(url.searchParams.get('days') ?? '7', 10);
      return json(
        route,
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
    }

    if (path === '/queues' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/queues/lex.publish/metrics' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/queues/lex.publish-dlq/metrics' && method === 'GET') {
      return json(
        route,
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
    }

    if (path.startsWith('/queues/') && path.endsWith('/jobs') && method === 'GET') {
      return json(route, envelope({ jobs: [], total: 0 }));
    }

    if (path === '/queues/workers' && method === 'GET') {
      return json(route, envelope({ workers: [] }));
    }

    if (path === '/bulk/current' && method === 'GET') {
      return json(route, envelope(null));
    }

    if (path === '/bulk' && method === 'GET') {
      return json(route, envelope({ runs: [] }));
    }

    if (
      (path === '/pim/stats/quality-distribution' ||
        path === '/pim/stats/cost-tracking' ||
        path === '/pim/stats/enrichment-progress') &&
      method === 'GET'
    ) {
      if (path === '/pim/stats/quality-distribution') {
        return json(route, envelope({ golden: 744, silver: 240, bronze: 120, review: 96 }));
      }
      if (path === '/pim/stats/cost-tracking') {
        return json(route, envelope({ todayCost: 28.5 }));
      }
      return json(route, envelope({ attentionProducts: 12, enrichmentRate: 0.93 }));
    }

    if (path === '/pim/lex/bootstrap' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/pim/lex/settings' && method === 'GET') {
      return json(
        route,
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
          },
        })
      );
    }

    if (path === '/pim/lex/metrics' && method === 'GET') {
      return json(
        route,
        envelope({
          metrics: {
            runsTotal: 15,
            termsTotal: 220,
            clustersTotal: 40,
            glossaryTotal: 12,
            reviewPending: 1,
            reviewBacklog: 4,
            localizationsApproved: 9,
            publicationsPending: state.publications.filter((item) => item.status === 'pending')
              .length,
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
          },
        })
      );
    }

    if (path === '/pim/lex/runs' && method === 'GET') {
      return json(
        route,
        envelope({
          runs: [
            {
              id: 'run-1',
              shopId: 'shop-1',
              runType: 'delta_rebuild',
              status: 'running',
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
    }

    if (path === '/pim/lex/localizations' && method === 'GET') {
      return json(
        route,
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
    }

    if (path === '/pim/lex/review' && method === 'GET') {
      return json(
        route,
        envelope({ items: state.reviewItems, page: { items: [], nextCursor: null } })
      );
    }

    if (path === '/pim/lex/review/review-1' && method === 'GET') {
      return json(route, envelope({ review: state.reviewDetail }));
    }

    if (path === '/pim/lex/glossary' && method === 'GET') {
      return json(route, envelope({ glossary: [] }));
    }

    if (path === '/pim/lex/rules' && method === 'GET') {
      return json(route, envelope({ rules: [] }));
    }

    if (path === '/pim/lex/profiles' && method === 'GET') {
      return json(route, envelope({ profiles: [] }));
    }

    if (path === '/pim/lex/stopwords' && method === 'GET') {
      return json(route, envelope({ stopwords: [] }));
    }

    if (path === '/pim/lex/governance' && method === 'GET') {
      return json(route, envelope({ requests: state.governanceRequests }));
    }

    if (path === '/pim/lex/publications' && method === 'GET') {
      return json(
        route,
        envelope({ publications: state.publications, page: { items: [], nextCursor: null } })
      );
    }

    if (path === '/pim/lex/publications/pub-1' && method === 'GET') {
      return json(route, envelope({ publication: state.publicationDetail }));
    }

    if (path === '/pim/lex/governance' && method === 'POST') {
      const nextId = `gov-${state.governanceRequests.length + 1}`;
      const payload = (body ?? {}) as { entityType?: string; title?: string };
      state.governanceRequests.unshift({
        id: nextId,
        entityType: payload.entityType ?? 'glossary_entry',
        requestScope: 'global',
        title: payload.title ?? nextId,
        status: 'draft',
        version: 1,
        createdAt: nowIso(),
        submittedAt: null,
      });
      return json(route, envelope({ requestId: nextId }));
    }

    if (path.startsWith('/pim/lex/governance/') && method === 'POST') {
      const segments = path.split('/').filter(Boolean);
      const requestId = segments[3];
      const action = segments[4];
      const requestRecord = state.governanceRequests.find((item) => item.id === requestId);
      if (requestRecord) {
        requestRecord.version += 1;
        if (action === 'submit') {
          requestRecord.status = 'pending_approval';
          requestRecord.submittedAt = nowIso();
        } else if (action === 'approve') {
          requestRecord.status = 'approved';
        } else if (action === 'apply') {
          requestRecord.status = 'applied';
        }
      }
      return json(route, envelope({ requestId, action }));
    }

    if (path.startsWith('/pim/lex/review/review-1/decision') && method === 'POST') {
      const payload = (body ?? {}) as { decisionType?: string; notes?: unknown };
      const decisionType = payload.decisionType ?? 'approve';
      state.reviewItems[0] = {
        ...state.reviewItems[0]!,
        status: decisionType === 'reject' ? 'rejected' : 'approved',
        version: state.reviewItems[0]!.version + 1,
      };
      state.reviewDetail = {
        ...state.reviewDetail,
        status: decisionType === 'reject' ? 'rejected' : 'approved',
        decisions: [
          {
            id: `decision-${state.reviewDetail.decisions.length + 1}`,
            decisionType,
            decisionNotes: typeof payload.notes === 'string' ? payload.notes : null,
            decidedBy: 'staff-1',
            createdAt: nowIso(),
            oldValue: {},
            newValue: { status: decisionType === 'reject' ? 'rejected' : 'approved' },
          },
          ...state.reviewDetail.decisions,
        ],
      };

      if (decisionType === 'publish') {
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

      return json(route, envelope({ reviewId: 'review-1', decisionType }));
    }

    if (path === '/pim/lex/publications/pub-1/retry' && method === 'POST') {
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
      return json(route, envelope({ publicationTargetId: 'pub-1', result: 'queued' }), 202);
    }

    if (path === '/pim/lex/publications/pub-1/rollback' && method === 'POST') {
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
      return json(route, envelope({ publicationTargetId: 'pub-1', result: 'rolled_back' }));
    }

    return json(route, envelope({ ok: true }));
  });

  return state;
}
