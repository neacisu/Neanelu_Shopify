import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PimTranslationsPage from '../app.pim.translations';

interface ApiClientStub {
  getApi: <T>(path: string) => Promise<T>;
  postApi: <T>(path: string, body: unknown) => Promise<T>;
  putApi: <T>(path: string, body: unknown) => Promise<T>;
}

const apiCalls: string[] = [];

function bootstrapResponse() {
  return {
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
        shardSize: 10000,
        autoPublishProducts: false,
        autoPublishAttributes: false,
        autoPublishCollections: false,
      },
    },
  };
}

function settingsResponse() {
  return {
    settings: {
      shopId: 'shop-1',
      version: 3,
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
      guardrailsLexMode: 'warn',
      guardrailsWarnThreshold: 1000,
      guardrailsWarnCount: 0,
      guardrailsBlockCount: 0,
      guardrailsFalsePositiveCount: 0,
      guardrailsLastEvaluatedAt: null,
    },
  };
}

function metricsResponse() {
  return {
    metrics: {
      runsTotal: 9,
      termsTotal: 120,
      clustersTotal: 25,
      glossaryTotal: 12,
      reviewPending: 4,
      reviewBacklog: 6,
      localizationsApproved: 11,
      publicationsPending: 3,
      runsActive: 2,
      runsPaused: 1,
      shardsFailed: 2,
      publicationsFailed: 1,
      publishConflicts: 1,
      staleCheckpoints: 2,
      retentionLag: 87000,
      aiBatchBacklog: 5,
      tmHits: 10,
      tmMisses: 5,
      tmHitRatePercent: (10 / 15) * 100,
      tmMissRatePercent: (5 / 15) * 100,
      tmAverageSimilarity: 0.94,
      dlqEntries: 2,
      workersOnline: 13,
      workersTotal: 14,
      alerts: [
        {
          key: 'lex-dlq-present',
          severity: 'critical',
          message: '2 job-uri lex sunt în DLQ.',
          href: '/queues?tab=jobs&queue=lex.publish-dlq',
          queueName: 'lex.publish-dlq',
          workerId: null,
        },
      ],
      workers: [
        {
          id: 'lex-publish-worker',
          label: 'Lex Publish',
          ok: false,
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
          waiting: 1,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 3,
          dlqEntries: 2,
          queueUrl: '/queues?tab=jobs&queue=lex.publish',
          dlqQueueName: 'lex.publish-dlq',
          dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
        },
      ],
    },
  };
}

function runsResponse() {
  return {
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
  };
}

function localizationsResponse() {
  return {
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
  };
}

function publicationsResponse() {
  return {
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
    page: { items: [], nextCursor: null },
  };
}

function publicationDetailResponse() {
  return {
    publication: {
      id: 'pub-1',
      localizationId: 'loc-1',
      targetType: 'prod_translations',
      targetRecordId: 'prod-1',
      targetPath: null,
      status: 'published',
      attemptCount: 2,
      errorMessage: null,
      updatedAt: '2026-03-15T11:00:00.000Z',
      payload: {},
      previousSnapshot: {},
      publishedSnapshot: { locale: 'en', title: 'Valve body' },
      rollbackable: false,
      rollbackBlockedReason: 'incomplete_prod_translations_snapshot',
      snapshotCompleteness: 'repairable',
      needsRepair: true,
      queueLinks: {
        queueName: 'lex.publish',
        queueUrl: '/queues?tab=jobs&queue=lex.publish',
        dlqQueueName: 'lex.publish-dlq',
        dlqUrl: '/queues?tab=jobs&queue=lex.publish-dlq',
      },
      events: [
        {
          id: 'evt-1',
          action: 'update',
          status: 'published',
          errorMessage: null,
          createdAt: '2026-03-15T11:00:00.000Z',
          requestPayload: {},
          responsePayload: {},
        },
      ],
    },
  };
}

function createApiStub(): ApiClientStub {
  return {
    getApi<T>(path: string): Promise<T> {
      apiCalls.push(path);
      if (path === '/pim/lex/bootstrap') return Promise.resolve(bootstrapResponse() as T);
      if (path === '/pim/lex/settings') return Promise.resolve(settingsResponse() as T);
      if (path === '/pim/lex/metrics') return Promise.resolve(metricsResponse() as T);
      if (path.startsWith('/pim/lex/runs')) return Promise.resolve(runsResponse() as T);
      if (path.startsWith('/pim/lex/localizations?'))
        return Promise.resolve(localizationsResponse() as T);
      if (path.startsWith('/pim/lex/publications?'))
        return Promise.resolve(publicationsResponse() as T);
      if (path === '/pim/lex/publications/pub-1')
        return Promise.resolve(publicationDetailResponse() as T);
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    },
    postApi<T>(_path: string, _body: unknown): Promise<T> {
      return Promise.resolve({} as T);
    },
    putApi<T>(_path: string, _body: unknown): Promise<T> {
      return Promise.resolve({} as T);
    },
  };
}

const api = vi.hoisted(() => createApiStub());

vi.mock('../../hooks/use-api', () => ({
  useApiClient: () => api,
}));

describe('PIM translations lexical operator UI', () => {
  beforeEach(() => {
    apiCalls.splice(0, apiCalls.length);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders overview with lexical alerts, workers, and queue health', async () => {
    render(
      <MemoryRouter initialEntries={['/pim/translations?tab=overview']}>
        <Routes>
          <Route path="/pim/translations" element={<PimTranslationsPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('System Alerts')).toBeInTheDocument();
    expect(screen.getByText('Queue Health')).toBeInTheDocument();
    expect(screen.getByText('Lex Publish')).toBeInTheDocument();
    expect(screen.getByText('2 job-uri lex sunt în DLQ.')).toBeInTheDocument();
    expect(screen.getAllByText('Queue').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(apiCalls).toContain('/pim/lex/metrics');
    });
  });

  it('renders publication rollback diagnostics and queue links', async () => {
    render(
      <MemoryRouter initialEntries={['/pim/translations?tab=publications&publicationId=pub-1']}>
        <Routes>
          <Route path="/pim/translations" element={<PimTranslationsPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Publication Detail')).toBeInTheDocument();
    expect(screen.getByText(/rollback repairable/i)).toBeInTheDocument();
    expect(screen.getByText('needs repair')).toBeInTheDocument();
    expect(screen.getByText('incomplete_prod_translations_snapshot')).toBeInTheDocument();
    expect(screen.getAllByText('DLQ').length).toBeGreaterThan(0);
  });
});
