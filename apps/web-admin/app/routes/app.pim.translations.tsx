import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  LexBootstrapDto,
  LexCursorPage,
  LexDomainProfileDto,
  LexGovernanceRequestDto,
  LexGlossaryEntryDto,
  LexLocalizationDetail,
  LexMetricsDto,
  LexPublicationDetailDto,
  LexPublicationTargetDto,
  LexReviewDetailDto,
  LexReviewItemDetail,
  LexRunSummary,
  LexShopSettingsDto,
  LexStopwordDto,
  LexTermDetail,
  LexTranslationRuleDto,
} from '@app/types';

import { Card } from '../components/ui/card';
import { Tabs } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/patterns/empty-state';
import { ErrorState } from '../components/patterns/error-state';
import { LoadingState } from '../components/patterns/loading-state';
import { useApiClient } from '../hooks/use-api';
import { withAppBasePath } from '../lib/base-path';

type TermsListItem = Readonly<{
  id: string;
  canonicalText: string;
  normalizedKey: string;
  displayTextRo: string | null;
  ngramSize: number;
  termType: string;
  domainCode: string | null;
  isTechnical: boolean;
  isProtected: boolean;
  status: string;
  occurrencesTotal: number;
  scoreGlobal: number | null;
}>;

function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ro-RO');
  } catch {
    return value;
  }
}

function formatDurationSeconds(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0s';
  if (value < 60) return `${Math.max(0, Math.round(value))}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function severityTone(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'border-rose-300 bg-rose-50 text-rose-900';
  if (severity === 'warning') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-sky-300 bg-sky-50 text-sky-900';
}

export default function PimTranslationsPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'overview';
  const selectedTermId = searchParams.get('termId');
  const selectedReviewId = searchParams.get('reviewId');
  const selectedPublicationId = searchParams.get('publicationId');
  const [bootstrap, setBootstrap] = useState<LexBootstrapDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<LexMetricsDto | null>(null);
  const [settings, setSettings] = useState<LexShopSettingsDto | null>(null);
  const [runs, setRuns] = useState<LexRunSummary[]>([]);
  const [terms, setTerms] = useState<TermsListItem[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<LexTermDetail | null>(null);
  const [localizations, setLocalizations] = useState<LexLocalizationDetail[]>([]);
  const [reviewItems, setReviewItems] = useState<LexReviewItemDetail[]>([]);
  const [selectedReview, setSelectedReview] = useState<LexReviewDetailDto | null>(null);
  const [glossary, setGlossary] = useState<LexGlossaryEntryDto[]>([]);
  const [rules, setRules] = useState<LexTranslationRuleDto[]>([]);
  const [profiles, setProfiles] = useState<LexDomainProfileDto[]>([]);
  const [stopwords, setStopwords] = useState<LexStopwordDto[]>([]);
  const [governance, setGovernance] = useState<LexGovernanceRequestDto[]>([]);
  const [publications, setPublications] = useState<LexPublicationTargetDto[]>([]);
  const [selectedPublication, setSelectedPublication] = useState<LexPublicationDetailDto | null>(
    null
  );

  const tabs = useMemo(
    () => [
      { label: 'Overview', value: 'overview' },
      { label: 'Runs', value: 'runs' },
      { label: 'Terms', value: 'terms' },
      { label: 'Review', value: 'review' },
      { label: 'Glossary', value: 'glossary' },
      { label: 'Rules', value: 'rules' },
      { label: 'Profiles', value: 'profiles' },
      { label: 'Stopwords', value: 'stopwords' },
      { label: 'Governance', value: 'governance' },
      { label: 'Publications', value: 'publications' },
      { label: 'Settings', value: 'settings' },
    ],
    []
  );

  const setTab = (value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', value);
      if (value !== 'terms') next.delete('termId');
      if (value !== 'review') next.delete('reviewId');
      if (value !== 'publications') next.delete('publicationId');
      return next;
    });
  };

  const setSelectionParam = (
    key: 'termId' | 'reviewId' | 'publicationId',
    value: string | null
  ) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const loadTermDetail = async (termId: string | null) => {
    if (!termId) {
      setSelectedTerm(null);
      return;
    }

    const detail = await api.getApi<{ term: LexTermDetail }>(`/pim/lex/terms/${termId}`);
    setSelectedTerm(detail.term);
  };

  const loadReviewDetail = async (reviewId: string | null) => {
    if (!reviewId) {
      setSelectedReview(null);
      return;
    }

    const detail = await api.getApi<{ review: LexReviewDetailDto }>(`/pim/lex/review/${reviewId}`);
    setSelectedReview(detail.review);
  };

  const loadPublicationDetail = async (publicationId: string | null) => {
    if (!publicationId) {
      setSelectedPublication(null);
      return;
    }

    const detail = await api.getApi<{ publication: LexPublicationDetailDto }>(
      `/pim/lex/publications/${publicationId}`
    );
    setSelectedPublication(detail.publication);
  };

  const loadTabData = async (tabValue: string) => {
    if (tabValue === 'overview') {
      const [runsResp, localizationsResp] = await Promise.all([
        api.getApi<{ runs: LexRunSummary[]; page: LexCursorPage<LexRunSummary> }>(
          '/pim/lex/runs?limit=6'
        ),
        api.getApi<{
          localizations: LexLocalizationDetail[];
          page: LexCursorPage<LexLocalizationDetail>;
        }>('/pim/lex/localizations?limit=5'),
      ]);

      setRuns(runsResp.runs);
      setLocalizations(localizationsResp.localizations);
      return;
    }

    if (tabValue === 'runs') {
      const runsResp = await api.getApi<{
        runs: LexRunSummary[];
        page: LexCursorPage<LexRunSummary>;
      }>('/pim/lex/runs?limit=50');
      setRuns(runsResp.runs);
      return;
    }

    if (tabValue === 'terms') {
      const termsResp = await api.getApi<{
        terms: TermsListItem[];
        page: LexCursorPage<TermsListItem>;
      }>('/pim/lex/terms?limit=60');
      setTerms(termsResp.terms);
      const nextTermId = selectedTermId ?? termsResp.terms[0]?.id ?? null;
      if (nextTermId) {
        if (nextTermId !== selectedTermId) setSelectionParam('termId', nextTermId);
        await loadTermDetail(nextTermId);
      } else {
        setSelectedTerm(null);
      }
      return;
    }

    if (tabValue === 'review') {
      const reviewResp = await api.getApi<{
        items: LexReviewItemDetail[];
        page: LexCursorPage<LexReviewItemDetail>;
      }>('/pim/lex/review?limit=50');
      setReviewItems(reviewResp.items);
      const nextReviewId = selectedReviewId ?? reviewResp.items[0]?.id ?? null;
      if (nextReviewId) {
        if (nextReviewId !== selectedReviewId) setSelectionParam('reviewId', nextReviewId);
        await loadReviewDetail(nextReviewId);
      } else {
        setSelectedReview(null);
      }
      return;
    }

    if (tabValue === 'glossary') {
      const glossaryResp = await api.getApi<{ glossary: LexGlossaryEntryDto[] }>(
        '/pim/lex/glossary'
      );
      setGlossary(glossaryResp.glossary);
      return;
    }

    if (tabValue === 'rules') {
      const rulesResp = await api.getApi<{ rules: LexTranslationRuleDto[] }>('/pim/lex/rules');
      setRules(rulesResp.rules);
      return;
    }

    if (tabValue === 'profiles') {
      const profilesResp = await api.getApi<{ profiles: LexDomainProfileDto[] }>(
        '/pim/lex/profiles'
      );
      setProfiles(profilesResp.profiles);
      return;
    }

    if (tabValue === 'stopwords') {
      const stopwordsResp = await api.getApi<{ stopwords: LexStopwordDto[] }>('/pim/lex/stopwords');
      setStopwords(stopwordsResp.stopwords);
      return;
    }

    if (tabValue === 'governance') {
      const governanceResp = await api.getApi<{ requests: LexGovernanceRequestDto[] }>(
        '/pim/lex/governance'
      );
      setGovernance(governanceResp.requests);
      return;
    }

    if (tabValue === 'publications') {
      const publicationsResp = await api.getApi<{
        publications: LexPublicationTargetDto[];
        page: LexCursorPage<LexPublicationTargetDto>;
      }>('/pim/lex/publications?limit=50');
      setPublications(publicationsResp.publications);
      const nextPublicationId =
        selectedPublicationId ?? publicationsResp.publications[0]?.id ?? null;
      if (nextPublicationId) {
        if (nextPublicationId !== selectedPublicationId)
          setSelectionParam('publicationId', nextPublicationId);
        await loadPublicationDetail(nextPublicationId);
      } else {
        setSelectedPublication(null);
      }
    }
  };

  const loadCurrentView = async () => {
    setLoading(true);
    setError(null);
    try {
      const bootstrapResp = await api.getApi<{ bootstrap: LexBootstrapDto }>('/pim/lex/bootstrap');
      setBootstrap(bootstrapResp.bootstrap);
      if (!bootstrapResp.bootstrap.permissions.canView) {
        setSettings(null);
        setMetrics(null);
        setRuns([]);
        setTerms([]);
        setSelectedTerm(null);
        setLocalizations([]);
        setReviewItems([]);
        setSelectedReview(null);
        setGlossary([]);
        setRules([]);
        setProfiles([]);
        setStopwords([]);
        setGovernance([]);
        setPublications([]);
        setSelectedPublication(null);
        return;
      }

      const [settingsResp, metricsResp] = await Promise.all([
        api.getApi<{ settings: LexShopSettingsDto }>('/pim/lex/settings'),
        api.getApi<{ metrics: LexMetricsDto }>('/pim/lex/metrics'),
      ]);

      setSettings(settingsResp.settings);
      setMetrics(metricsResp.metrics);
      await loadTabData(activeTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut încărca modulul lexical.');
    } finally {
      setLoading(false);
    }
  };

  const loadAll = loadCurrentView;

  useEffect(() => {
    void loadCurrentView();
  }, [activeTab]);

  useEffect(() => {
    if (bootstrap == null) return;
    if (bootstrap.permissions.canView) return;
    void navigate('/pim', { replace: true });
  }, [bootstrap, navigate]);

  const selectTerm = async (termId: string) => {
    try {
      setSelectionParam('termId', termId);
      await loadTermDetail(termId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut încărca detaliile termenului.');
    }
  };

  const selectReview = async (reviewId: string) => {
    try {
      setSelectionParam('reviewId', reviewId);
      await loadReviewDetail(reviewId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut încărca detaliile review-ului.');
    }
  };

  const selectPublication = async (publicationId: string) => {
    try {
      setSelectionParam('publicationId', publicationId);
      await loadPublicationDetail(publicationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut încărca detaliile publicării.');
    }
  };

  const handleStartRun = async (runType: LexRunSummary['runType']) => {
    setStartingRun(true);
    setError(null);
    try {
      await api.postApi('/pim/lex/runs', {
        runType,
        sourceScope: settings?.extractScope ?? {
          entityTypes: ['product', 'variant', 'collection'],
        },
      });
      setTab('runs');
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut porni un run lexical.');
    } finally {
      setStartingRun(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setError(null);
    try {
      await api.putApi('/pim/lex/settings', settings);
      await loadCurrentView();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nu am putut salva setările modulului lexical.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReviewDecision = async (id: string, decisionType: 'approve' | 'reject') => {
    try {
      const reviewItem = reviewItems.find((item) => item.id === id);
      if (!reviewItem) return;

      await api.postApi(`/pim/lex/review/${id}/decision`, {
        decisionType,
        expectedVersion: reviewItem.version,
        notes:
          decisionType === 'approve'
            ? 'Approved from PIM translations review.'
            : 'Rejected from PIM translations review.',
      });
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut salva decizia de review.');
    }
  };

  const handleAdvancedReviewDecision = async (
    id: string,
    decisionType: 'publish' | 'lock_translation'
  ) => {
    try {
      const reviewItem = reviewItems.find((item) => item.id === id);
      if (!reviewItem) return;

      await api.postApi(`/pim/lex/review/${id}/decision`, {
        decisionType,
        expectedVersion: reviewItem.version,
        notes:
          decisionType === 'publish'
            ? 'Publish requested from PIM translations workspace.'
            : 'Translation locked from PIM translations workspace.',
      });
      await loadCurrentView();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nu am putut executa acțiunea avansată de review.'
      );
    }
  };

  const handleRetryPublication = async (id: string) => {
    try {
      await api.postApi(`/pim/lex/publications/${id}/retry`, {});
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut reîncerca publicarea.');
    }
  };

  const handleRollbackPublication = async (id: string) => {
    try {
      await api.postApi(`/pim/lex/publications/${id}/rollback`, {});
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut face rollback pentru publicare.');
    }
  };

  const handlePromoteToGovernance = async (
    entityType: LexGovernanceRequestDto['entityType'],
    targetId: string,
    title: string,
    payload: Record<string, unknown>
  ) => {
    try {
      await api.postApi('/pim/lex/governance', {
        entityType,
        targetId,
        title,
        payload,
      });
      setTab('governance');
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea request-ul de governance.');
    }
  };

  const handleGovernanceTransition = async (
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'apply'
  ) => {
    try {
      const request = governance.find((item) => item.id === id);
      if (!request) return;

      await api.postApi(`/pim/lex/governance/${id}/${action}`, {
        expectedVersion: request.version,
      });
      await loadCurrentView();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nu am putut actualiza request-ul de governance.'
      );
    }
  };

  if (loading) {
    return <LoadingState label="Se încarcă modulul Translation Intelligence..." />;
  }

  if (bootstrap && !bootstrap.permissions.canView) {
    return (
      <EmptyState
        title="Translation Intelligence nu este disponibil"
        description="Modulul lexical este dezactivat pentru shop-ul curent sau contul tău nu are acces administrativ."
      />
    );
  }

  if (error && !settings) {
    return <ErrorState message={error} onRetry={() => void loadCurrentView()} />;
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorState message={error} onRetry={() => void loadCurrentView()} /> : null}

      <Card
        padding="lg"
        className="overflow-hidden border-border bg-[radial-gradient(circle_at_top_left,rgba(214,116,72,0.15),transparent_40%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(249,244,238,0.96))]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Translation Intelligence
            </p>
            <h2 className="text-h3 text-foreground">
              Lexicon, sensuri, review și publicare controlată
            </h2>
            <p className="max-w-3xl text-sm text-muted">
              Modulul lexical stă peste mirror-ul Shopify și PIM-ul global, păstrează contextul real
              al termenilor și transformă traducerile aprobate în ieșiri publicabile pentru produse,
              atribute și colecții.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={startingRun} onClick={() => void handleStartRun('delta_rebuild')}>
              {startingRun ? 'Pornesc...' : 'Start Delta Rebuild'}
            </Button>
            <Button
              variant="secondary"
              disabled={startingRun}
              onClick={() => void handleStartRun('full_rebuild')}
            >
              Full Rebuild
            </Button>
          </div>
        </div>
      </Card>

      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={setTab}
        ariaLabel="Translation Intelligence sections"
      />

      {activeTab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Runs', value: metrics?.runsTotal ?? 0, hint: 'Total execuții create' },
              { label: 'Terms', value: metrics?.termsTotal ?? 0, hint: 'Termeni disponibili' },
              {
                label: 'Review Pending',
                value: metrics?.reviewPending ?? 0,
                hint: 'Decizii care așteaptă aprobare',
              },
              {
                label: 'Approved Localizations',
                value: metrics?.localizationsApproved ?? 0,
                hint: 'Entități gata de publish',
              },
              {
                label: 'Runs Active',
                value: metrics?.runsActive ?? 0,
                hint: 'Execuții încă active sau în pauză',
              },
              {
                label: 'Runs Paused',
                value: metrics?.runsPaused ?? 0,
                hint: 'Run-uri oprite de budget, provider sau intervenție umană',
              },
              {
                label: 'Shards Failed',
                value: metrics?.shardsFailed ?? 0,
                hint: 'Shards terminate cu eroare',
              },
              {
                label: 'Publish Conflicts',
                value: metrics?.publishConflicts ?? 0,
                hint: 'Conflicte cu targete manuale sau drift',
              },
              {
                label: 'Stale Checkpoints',
                value: metrics?.staleCheckpoints ?? 0,
                hint: 'Heartbeat-uri stale peste 15 minute',
              },
              {
                label: 'AI Backlog',
                value: metrics?.aiBatchBacklog ?? 0,
                hint: 'Item-uri lex încă în AI batch processing',
              },
              {
                label: 'DLQ Entries',
                value: metrics?.dlqEntries ?? 0,
                hint: 'Job-uri lex blocate în DLQ',
              },
              {
                label: 'Workers Online',
                value: metrics == null ? 0 : `${metrics.workersOnline}/${metrics.workersTotal}`,
                hint: 'Worker-ele și scheduler-ele lex active',
              },
              {
                label: 'Retention Lag',
                value: formatDurationSeconds(metrics?.retentionLag ?? 0),
                hint: 'Vechimea celui mai vechi fragment hot încă păstrat',
              },
            ].map((item) => (
              <Card key={item.label} padding="md" variant="bordered" className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">{item.label}</p>
                <p className="text-h3 text-foreground">{item.value}</p>
                <p className="text-sm text-muted">{item.hint}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_minmax(0,0.8fr)]">
            <Card padding="md" variant="bordered" className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">System Alerts</h3>
                  <p className="text-sm text-muted">
                    Semnale operaționale alimentate din același snapshot folosit de OTEL și PIM.
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void loadCurrentView()}>
                  Refresh
                </Button>
              </div>
              {!metrics || metrics.alerts.length === 0 ? (
                <EmptyState
                  title="Nicio alertă lexicală activă"
                  description="Pipeline-ul, publish-ul și retention-ul par sănătoase pentru shop-ul curent."
                />
              ) : (
                <div className="space-y-2">
                  {metrics.alerts.map((alert) => (
                    <div
                      key={alert.key}
                      className={`rounded-lg border px-3 py-3 ${severityTone(alert.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                            {alert.severity}
                          </p>
                          <p className="text-sm font-medium">{alert.message}</p>
                        </div>
                        {alert.href ? (
                          <a
                            className="text-xs font-semibold underline"
                            href={withAppBasePath(alert.href)}
                          >
                            Open
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card padding="md" variant="bordered" className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Worker Health</h3>
              {!metrics || metrics.workers.length === 0 ? (
                <EmptyState
                  title="Nicio informație despre worker-e"
                  description="Health-ul worker-elor lex va apărea aici după primul refresh de metrics."
                />
              ) : (
                <div className="space-y-2">
                  {metrics.workers.map((worker) => (
                    <div
                      key={worker.id}
                      className="rounded-lg border border-border bg-card px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{worker.label}</p>
                          <p className="text-xs text-muted">{worker.id}</p>
                          <p className="text-xs text-muted">
                            {worker.currentJob
                              ? `${worker.currentJob.jobName} · started ${formatDate(worker.currentJob.startedAtIso)}`
                              : 'Idle'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-xs font-semibold ${worker.ok ? 'text-emerald-700' : 'text-rose-700'}`}
                          >
                            {worker.ok ? 'online' : 'offline'}
                          </p>
                          {worker.queueUrl ? (
                            <a
                              className="text-xs underline text-muted"
                              href={withAppBasePath(worker.queueUrl)}
                            >
                              Queue
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card padding="md" variant="bordered" className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Queue Health</h3>
                <p className="text-sm text-muted">
                  Backlog, eșecuri și DLQ pe fiecare fază lexicală, cu deep-link direct spre
                  monitorul generic de cozi.
                </p>
              </div>
              <a
                className="text-sm font-medium text-primary underline"
                href={withAppBasePath('/queues?tab=overview')}
              >
                Open Queue Monitor
              </a>
            </div>
            {!metrics || metrics.queues.length === 0 ? (
              <EmptyState
                title="Nu există queue health disponibil"
                description="Aici apare distribuția reală pe cozi și DLQ-uri după primul snapshot lexical."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Queue</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Waiting</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Active</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Delayed</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Failed</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">DLQ</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.queues.map((queue) => (
                      <tr key={queue.name} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{queue.name}</td>
                        <td className="px-3 py-2 text-muted">{queue.waiting}</td>
                        <td className="px-3 py-2 text-muted">{queue.active}</td>
                        <td className="px-3 py-2 text-muted">{queue.delayed}</td>
                        <td className="px-3 py-2 text-muted">{queue.failed}</td>
                        <td className="px-3 py-2 text-muted">{queue.dlqEntries}</td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-wrap gap-2">
                            <a
                              className="text-primary underline"
                              href={withAppBasePath(queue.queueUrl)}
                            >
                              Queue
                            </a>
                            <a
                              className="text-primary underline"
                              href={withAppBasePath(queue.dlqUrl)}
                            >
                              DLQ
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_minmax(0,1fr)]">
            <Card padding="md" variant="bordered" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">Latest Runs</h3>
                <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
                  Refresh
                </Button>
              </div>
              {runs.length === 0 ? (
                <EmptyState
                  title="Nu există run-uri lexicale"
                  description="Pornește primul rebuild ca să începi extracția, clusteringul și traducerea contextuală."
                />
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted">Tip</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Fragmente</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Traduceri</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Start</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.slice(0, 6).map((run) => (
                        <tr key={run.id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{run.runType}</td>
                          <td className="px-3 py-2 text-muted">{run.status}</td>
                          <td className="px-3 py-2 text-muted">{run.fragmentsCount}</td>
                          <td className="px-3 py-2 text-muted">{run.translationsCount}</td>
                          <td className="px-3 py-2 text-muted">{formatDate(run.startedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card padding="md" variant="bordered" className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Approved Localizations</h3>
              {localizations.length === 0 ? (
                <EmptyState
                  title="Nicio localizare aprobată"
                  description="După review și compunere, aici vor apărea localizările gata de publicare."
                />
              ) : (
                <div className="space-y-2">
                  {localizations.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-border bg-card/80 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {item.entityType} · {item.targetLang.toUpperCase()}
                          </p>
                          <p className="text-xs text-muted">
                            {item.titleText ?? item.descriptionShort ?? 'Fără titlu publicabil'}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-primary">
                          {item.publicationStatus}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === 'runs' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Execution Runs</h3>
              <p className="text-sm text-muted">
                Istoric complet pentru rebuild-uri și pipeline-uri de publicare.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleStartRun('translate_only')}
              >
                Translate Only
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
                Refresh
              </Button>
            </div>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              title="Nu există run-uri"
              description="Creează primul run lexical pentru a popula inventarul de termeni și sensuri."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted">Run</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Terms</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Contexts</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Translations</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{run.runType}</div>
                        <div className="text-xs text-muted">{run.id}</div>
                      </td>
                      <td className="px-3 py-2 text-muted">{run.status}</td>
                      <td className="px-3 py-2 text-muted">{run.termsCount}</td>
                      <td className="px-3 py-2 text-muted">{run.contextsCount}</td>
                      <td className="px-3 py-2 text-muted">{run.translationsCount}</td>
                      <td className="px-3 py-2 text-xs text-muted">{run.errorMessage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === 'terms' ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
          <Card padding="md" variant="bordered" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Term Inventory</h3>
              <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
                Refresh
              </Button>
            </div>
            {terms.length === 0 ? (
              <EmptyState
                title="Inventar gol"
                description="După fragment extraction și term mining, termenii vor apărea aici."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Term</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Tip</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Occ.</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Scor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terms.slice(0, 60).map((term) => (
                      <tr
                        key={term.id}
                        className="cursor-pointer border-t border-border hover:bg-subtle"
                        onClick={() => void selectTerm(term.id)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{term.canonicalText}</div>
                          <div className="text-xs text-muted">
                            {term.domainCode ?? 'fără domeniu'}
                            {term.isProtected ? ' · protected' : ''}
                            {term.isTechnical ? ' · technical' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted">{term.termType}</td>
                        <td className="px-3 py-2 text-muted">{term.occurrencesTotal}</td>
                        <td className="px-3 py-2 text-muted">{formatScore(term.scoreGlobal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padding="md" variant="bordered" className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Term Detail</h3>
            {!selectedTerm ? (
              <EmptyState
                title="Selectează un termen"
                description="Vezi aici variantele, sensurile și cluster-ele aprobate pentru termenul ales."
              />
            ) : (
              <>
                <div className="rounded-lg border border-border bg-subtle/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    {selectedTerm.termType}
                  </p>
                  <h4 className="mt-1 text-xl font-semibold text-foreground">
                    {selectedTerm.canonicalText}
                  </h4>
                  <p className="mt-1 text-sm text-muted">
                    Key: {selectedTerm.normalizedKey} · ngram {selectedTerm.ngramSize} ·{' '}
                    {selectedTerm.status}
                  </p>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Variants
                  </h5>
                  {selectedTerm.variants.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nu există variante aprobate sau extrase încă.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTerm.variants.map((variant) => (
                        <div
                          key={variant.id}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-foreground">
                              {variant.variantText}
                            </span>
                            <span className="text-xs text-muted">
                              {variant.locale} · {variant.variantType}
                              {variant.isPreferred ? ' · preferred' : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Sense Clusters
                  </h5>
                  {selectedTerm.clusters.length === 0 ? (
                    <p className="text-sm text-muted">Nu există cluster-e pentru acest termen.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTerm.clusters.map((cluster) => (
                        <div
                          key={cluster.id}
                          className="rounded-lg border border-border bg-card px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-foreground">
                                {cluster.labelRo ?? cluster.clusterKey}
                              </p>
                              <p className="text-xs text-muted">
                                {cluster.clusterMethod} · {cluster.domainCode ?? 'fără domeniu'} ·
                                scor {formatScore(cluster.confidenceScore)}
                              </p>
                            </div>
                            <span className="text-xs font-medium text-primary">
                              {cluster.isApproved
                                ? 'approved'
                                : cluster.needsReview
                                  ? 'needs review'
                                  : 'draft'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}

      {activeTab === 'review' ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
          <Card padding="md" variant="bordered" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Review Queue</h3>
                <p className="text-sm text-muted">
                  Cazuri ambigue, conflicte de reguli și rezultate cu încredere mică.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
                Refresh
              </Button>
            </div>
            {reviewItems.length === 0 ? (
              <EmptyState
                title="Review queue goală"
                description="Când pipeline-ul detectează ambiguități sau conflicte, le va pune aici."
              />
            ) : (
              <div className="space-y-3">
                {reviewItems.map((item) => (
                  <div
                    key={item.id}
                    className={`cursor-pointer rounded-xl border p-4 ${
                      selectedReview?.id === item.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    }`}
                    onClick={() => void selectReview(item.id)}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted">
                          {item.entityType} · {item.reviewReason}
                        </p>
                        <p className="font-medium text-foreground">{item.entityId}</p>
                        <p className="text-sm text-muted">
                          Severitate {item.severity} · prioritate {item.priority} · status{' '}
                          {item.status}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleReviewDecision(item.id, 'approve');
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleReviewDecision(item.id, 'reject');
                          }}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleAdvancedReviewDecision(item.id, 'publish');
                          }}
                        >
                          Publish
                        </Button>
                        {item.entityType === 'translation' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleAdvancedReviewDecision(item.id, 'lock_translation');
                            }}
                          >
                            Lock
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padding="md" variant="bordered" className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Review Detail</h3>
            {!selectedReview ? (
              <EmptyState
                title="Selectează un item de review"
                description="Aici apar evidence, timeline-ul deciziilor și impactul publicării."
              />
            ) : (
              <>
                <div className="rounded-lg border border-border bg-subtle/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    {selectedReview.entityType} · {selectedReview.reviewReason}
                  </p>
                  <h4 className="mt-1 text-xl font-semibold text-foreground">
                    {selectedReview.entityId}
                  </h4>
                  <p className="mt-1 text-sm text-muted">
                    status {selectedReview.status} · severitate {selectedReview.severity} ·
                    prioritate {selectedReview.priority}
                  </p>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Evidence
                  </h5>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs text-muted">
                    {JSON.stringify(selectedReview.evidence, null, 2)}
                  </pre>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Decisions
                  </h5>
                  {selectedReview.decisions.length === 0 ? (
                    <p className="text-sm text-muted">
                      Încă nu există decizii salvate pentru acest item.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedReview.decisions.map((decision) => (
                        <div
                          key={decision.id}
                          className="rounded-lg border border-border bg-card px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-foreground">
                              {decision.decisionType}
                            </span>
                            <span className="text-xs text-muted">
                              {formatDate(decision.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {decision.decisionNotes ?? 'Fără note.'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Publication Impact
                  </h5>
                  {selectedReview.relatedPublications.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nu există publication targets legate de acest item.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedReview.relatedPublications.map((publication) => (
                        <button
                          key={publication.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left"
                          onClick={() => {
                            setTab('publications');
                            void selectPublication(publication.id);
                          }}
                        >
                          <span className="font-medium text-foreground">
                            {publication.targetType}
                          </span>
                          <span className="text-xs text-muted">{publication.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}

      {activeTab === 'glossary' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Approved Glossary</h3>
              <p className="text-sm text-muted">
                Reguli deterministe care bat întotdeauna modelul atunci când există claritate.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
          {glossary.length === 0 ? (
            <EmptyState
              title="Glosar gol"
              description="Intrările aprobate manual sau promovate din review vor apărea aici."
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  Shop Override
                </p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted">Source</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Kind</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Lock</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {glossary
                        .filter((entry) => entry.shopId)
                        .map((entry) => (
                          <tr key={entry.id} className="border-t border-border">
                            <td className="px-3 py-2 font-medium text-foreground">
                              {entry.sourceText}
                            </td>
                            <td className="px-3 py-2 text-muted">{entry.targetText}</td>
                            <td className="px-3 py-2 text-muted">{entry.translationKind}</td>
                            <td className="px-3 py-2 text-muted">{entry.priority}</td>
                            <td className="px-3 py-2 text-muted">
                              {entry.isLocked ? 'locked' : 'open'}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void handlePromoteToGovernance(
                                    'glossary_entry',
                                    entry.id,
                                    `Promote glossary: ${entry.sourceText}`,
                                    {
                                      domainCode: entry.domainCode,
                                      sourceLang: entry.sourceLang,
                                      targetLang: entry.targetLang,
                                      sourceText: entry.sourceText,
                                      targetText: entry.targetText,
                                      translationKind: entry.translationKind,
                                      priority: entry.priority,
                                      isLocked: entry.isLocked,
                                      isActive: entry.isActive,
                                    }
                                  )
                                }
                              >
                                Promote Global
                              </Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  Global Canon
                </p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted">Source</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Kind</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">Lock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {glossary
                        .filter((entry) => !entry.shopId)
                        .map((entry) => (
                          <tr key={entry.id} className="border-t border-border">
                            <td className="px-3 py-2 font-medium text-foreground">
                              {entry.sourceText}
                            </td>
                            <td className="px-3 py-2 text-muted">{entry.targetText}</td>
                            <td className="px-3 py-2 text-muted">{entry.translationKind}</td>
                            <td className="px-3 py-2 text-muted">{entry.priority}</td>
                            <td className="px-3 py-2 text-muted">
                              {entry.isLocked ? 'locked' : 'open'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === 'rules' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Translation Rules</h3>
              <p className="text-sm text-muted">
                Reguli explicite cu precedence peste AI acolo unde terminologia este fixă.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Shop Override
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Rule</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Match</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules
                      .filter((item) => item.shopId)
                      .map((item) => (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{item.ruleName}</td>
                          <td className="px-3 py-2 text-muted">{item.matchTerm}</td>
                          <td className="px-3 py-2 text-muted">{item.targetTranslation}</td>
                          <td className="px-3 py-2 text-muted">{item.priority}</td>
                          <td className="px-3 py-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void handlePromoteToGovernance(
                                  'translation_rule',
                                  item.id,
                                  `Promote rule: ${item.ruleName}`,
                                  {
                                    ruleName: item.ruleName,
                                    sourceLang: item.sourceLang,
                                    targetLang: item.targetLang,
                                    matchTerm: item.matchTerm,
                                    domainCode: item.domainCode,
                                    targetTranslation: item.targetTranslation,
                                    priority: item.priority,
                                    isActive: item.isActive,
                                  }
                                )
                              }
                            >
                              Promote Global
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                Global Canon
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Rule</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Match</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules
                      .filter((item) => !item.shopId)
                      .map((item) => (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{item.ruleName}</td>
                          <td className="px-3 py-2 text-muted">{item.matchTerm}</td>
                          <td className="px-3 py-2 text-muted">{item.targetTranslation}</td>
                          <td className="px-3 py-2 text-muted">{item.priority}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {activeTab === 'profiles' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Domain Profiles</h3>
              <p className="text-sm text-muted">
                Profile de domeniu folosite la clustering, protecție de tokeni și stil.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted">Scope</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Domain</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Action</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted">{item.shopId ? 'shop' : 'global'}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{item.domainCode}</td>
                    <td className="px-3 py-2 text-muted">{item.nameRo}</td>
                    <td className="px-3 py-2 text-muted">
                      {item.isActive ? 'active' : 'inactive'}
                    </td>
                    <td className="px-3 py-2">
                      {item.shopId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void handlePromoteToGovernance(
                              'domain_profile',
                              item.id,
                              `Promote profile: ${item.domainCode}`,
                              {
                                domainCode: item.domainCode,
                                nameRo: item.nameRo,
                                nameEn: item.nameEn,
                                description: item.description,
                                isActive: item.isActive,
                              }
                            )
                          }
                        >
                          Promote Global
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">Canonical</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activeTab === 'stopwords' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Stopwords</h3>
              <p className="text-sm text-muted">
                Zgomot lexical și termeni ignorați în mining/context building.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted">Scope</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Locale</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Word</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-muted">Action</th>
                </tr>
              </thead>
              <tbody>
                {stopwords.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted">{item.shopId ? 'shop' : 'global'}</td>
                    <td className="px-3 py-2 text-muted">{item.locale}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{item.word}</td>
                    <td className="px-3 py-2 text-muted">{item.wordType}</td>
                    <td className="px-3 py-2">
                      {item.shopId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void handlePromoteToGovernance(
                              'stopword',
                              item.id,
                              `Promote stopword: ${item.word}`,
                              {
                                locale: item.locale,
                                word: item.word,
                                wordType: item.wordType,
                                priority: item.priority,
                                isActive: item.isActive,
                              }
                            )
                          }
                        >
                          Promote Global
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">Canonical</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activeTab === 'governance' ? (
        <Card padding="md" variant="bordered" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Global Canon Governance</h3>
              <p className="text-sm text-muted">
                Maker-checker lane pentru promovarea regulilor și a canonului global.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
          {governance.length === 0 ? (
            <EmptyState
              title="Nu există request-uri de governance"
              description="Promovează un override de shop către global canon ca să pornești un flux maker-checker."
            />
          ) : (
            <div className="space-y-3">
              {governance.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">
                        {item.entityType} · {item.requestScope}
                      </p>
                      <p className="font-medium text-foreground">{item.title ?? item.id}</p>
                      <p className="text-sm text-muted">
                        status {item.status} · version {item.version}
                      </p>
                      <p className="text-xs text-muted">
                        created {formatDate(item.createdAt)} · submitted{' '}
                        {formatDate(item.submittedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.status === 'draft' ? (
                        <Button
                          size="sm"
                          onClick={() => void handleGovernanceTransition(item.id, 'submit')}
                        >
                          Submit
                        </Button>
                      ) : null}
                      {item.status === 'pending_approval' ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void handleGovernanceTransition(item.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleGovernanceTransition(item.id, 'reject')}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {item.status === 'approved' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleGovernanceTransition(item.id, 'apply')}
                        >
                          Apply Canon
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === 'publications' ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
          <Card padding="md" variant="bordered" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Publication Targets</h3>
                <p className="text-sm text-muted">
                  Starea publicării în `prod_translations`, `prod_attr_synonyms`, `prod_semantics`
                  și colecții.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
                Refresh
              </Button>
            </div>
            {publications.length === 0 ? (
              <EmptyState
                title="Fără publication targets"
                description="După aprobare și compunere, aici vor apărea operațiile de publicare și retry."
              />
            ) : (
              <div className="space-y-3">
                {publications.map((item) => (
                  <div
                    key={item.id}
                    className={`cursor-pointer rounded-xl border p-4 ${
                      selectedPublication?.id === item.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    }`}
                    onClick={() => void selectPublication(item.id)}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{item.targetType}</p>
                        <p className="text-sm text-muted">
                          {item.targetPath ?? item.targetRecordId ?? 'fără destinație'} · status{' '}
                          {item.status} · attempt {item.attemptCount}
                        </p>
                        <p className="text-xs text-muted">
                          {item.errorMessage ?? 'Nicio eroare înregistrată.'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRetryPublication(item.id);
                        }}
                      >
                        Retry Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRollbackPublication(item.id);
                        }}
                      >
                        Rollback
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padding="md" variant="bordered" className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Publication Detail</h3>
            {!selectedPublication ? (
              <EmptyState
                title="Selectează un publication target"
                description="Aici apar snapshot-urile, eligibilitatea de rollback și istoricul de evenimente."
              />
            ) : (
              <>
                <div className="rounded-lg border border-border bg-subtle/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    {selectedPublication.targetType}
                  </p>
                  <h4 className="mt-1 text-xl font-semibold text-foreground">
                    {selectedPublication.targetPath ??
                      selectedPublication.targetRecordId ??
                      selectedPublication.id}
                  </h4>
                  <p className="mt-1 text-sm text-muted">
                    status {selectedPublication.status} · attempts{' '}
                    {selectedPublication.attemptCount}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-1 font-semibold ${
                        selectedPublication.rollbackable
                          ? 'bg-emerald-100 text-emerald-800'
                          : selectedPublication.snapshotCompleteness === 'repairable'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      rollback{' '}
                      {selectedPublication.rollbackable
                        ? 'enabled'
                        : selectedPublication.snapshotCompleteness}
                    </span>
                    {selectedPublication.needsRepair ? (
                      <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
                        needs repair
                      </span>
                    ) : null}
                    {selectedPublication.rollbackBlockedReason ? (
                      <span className="rounded-full bg-card px-2 py-1 text-muted">
                        {selectedPublication.rollbackBlockedReason}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    <a
                      className="font-medium text-primary underline"
                      href={withAppBasePath(selectedPublication.queueLinks.queueUrl)}
                    >
                      Queue
                    </a>
                    <a
                      className="font-medium text-primary underline"
                      href={withAppBasePath(selectedPublication.queueLinks.dlqUrl)}
                    >
                      DLQ
                    </a>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Snapshots
                  </h5>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs text-muted">
                      {JSON.stringify(selectedPublication.previousSnapshot, null, 2)}
                    </pre>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs text-muted">
                      {JSON.stringify(selectedPublication.publishedSnapshot, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                    Timeline
                  </h5>
                  {selectedPublication.events.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nu există evenimente de publish pentru acest target.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedPublication.events.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-lg border border-border bg-card px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-foreground">
                              {event.action} · {event.status}
                            </span>
                            <span className="text-xs text-muted">
                              {formatDate(event.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {event.errorMessage ?? 'Fără eroare.'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}

      {activeTab === 'settings' ? (
        <Card padding="md" variant="bordered" className="space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Lex Module Settings</h3>
            <p className="text-sm text-muted">
              Controlul operațional pentru scope, retenție și autopublish. Configurația este strict
              per-shop.
            </p>
          </div>

          {!settings ? (
            <EmptyState
              title="Setările nu sunt disponibile"
              description="Reîncarcă pagina sau verifică dacă API-ul lexical este pornit."
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm font-medium text-foreground">Source language</span>
                    <input
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                      value={settings.sourceLang}
                      onChange={(event) =>
                        setSettings((current) =>
                          current ? { ...current, sourceLang: event.target.value } : current
                        )
                      }
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-medium text-foreground">Target languages</span>
                    <input
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                      value={settings.targetLangs.join(', ')}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                targetLangs: event.target.value
                                  .split(',')
                                  .map((value) => value.trim())
                                  .filter((value) => value.length > 0),
                              }
                            : current
                        )
                      }
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm font-medium text-foreground">Shard size</span>
                    <input
                      type="number"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                      value={settings.shardSize}
                      onChange={(event) =>
                        setSettings((current) =>
                          current ? { ...current, shardSize: Number(event.target.value) } : current
                        )
                      }
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-medium text-foreground">
                      Retention contexts (days)
                    </span>
                    <input
                      type="number"
                      className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                      value={settings.retentionDaysContexts}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? { ...current, retentionDaysContexts: Number(event.target.value) }
                            : current
                        )
                      }
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-foreground">Extract scope JSON</span>
                  <textarea
                    rows={6}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground"
                    value={JSON.stringify(settings.extractScope, null, 2)}
                    onChange={(event) => {
                      try {
                        const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                        setSettings((current) =>
                          current ? { ...current, extractScope: parsed } : current
                        );
                      } catch {
                        // Keep the current valid state while the user edits invalid JSON.
                      }
                    }}
                  />
                </label>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-subtle/40 p-4">
                <Checkbox
                  checked={settings.enabled}
                  label="Enable lexical module"
                  description="Activează run-uri, UI și API-uri pentru Module N."
                  onChange={(event) =>
                    setSettings((current) =>
                      current ? { ...current, enabled: event.target.checked } : current
                    )
                  }
                />
                <Checkbox
                  checked={settings.autoPublishProducts}
                  label="Auto publish products"
                  description="Permite publicarea în `prod_translations` din localizări aprobate."
                  onChange={(event) =>
                    setSettings((current) =>
                      current ? { ...current, autoPublishProducts: event.target.checked } : current
                    )
                  }
                />
                <Checkbox
                  checked={settings.autoPublishAttributes}
                  label="Auto publish attributes"
                  description="Permite publicarea sinonimelor rezolvate către `prod_attr_synonyms`."
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? { ...current, autoPublishAttributes: event.target.checked }
                        : current
                    )
                  }
                />
                <Checkbox
                  checked={settings.autoPublishCollections}
                  label="Auto publish collections"
                  description="Permite write-through în `shopify_collections.title_en/description_en`."
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? { ...current, autoPublishCollections: event.target.checked }
                        : current
                    )
                  }
                />
                <Button disabled={savingSettings} onClick={() => void handleSaveSettings()}>
                  {savingSettings ? 'Salvez...' : 'Save Settings'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
