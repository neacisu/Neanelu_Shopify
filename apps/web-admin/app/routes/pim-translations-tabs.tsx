import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type {
  LexAccessPermissions,
  LexDomainProfileDto,
  LexGovernanceRequestDto,
  LexGlossaryEntryDto,
  LexGuardrailsEventDto,
  LexGuardrailsMode,
  LexGuardrailsStatsDto,
  LexLocalizationDetail,
  LexMetricsDto,
  LexPublicationDetailDto,
  LexPublicationTargetDto,
  LexReviewDetailDto,
  LexReviewItemDetail,
  LexRunSummary,
  LexShopSettingsDto,
  LexStopwordDto,
  LexTermAffectedProductDto,
  LexTermDetail,
  LexTermFlagsPatchRequest,
  LexTranslationRuleDto,
} from '@app/types';
import {
  LEX_ENTITY_TYPES,
  LEX_PUBLICATION_TARGET_STATUSES,
  LEX_PUBLICATION_TARGET_TYPES,
  LEX_REVIEW_SEVERITIES,
  LEX_REVIEW_STATUSES,
} from '@app/types';

import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { SearchInput } from '../components/ui/SearchInput';
import { EmptyState } from '../components/patterns/empty-state';
import { withAppBasePath } from '../lib/base-path';
import {
  formatScore,
  formatDate,
  formatDurationSeconds,
  formatLexPauseReason,
  severityTone,
  runStatusClass,
  clusterStatusLabel,
  rollbackToneClass,
} from './app.pim.translations';
import {
  GlossaryTabPanel,
  type LexGlossaryCreatePayload,
  type LexGlossaryUpdatePayload,
} from './glossary-tab-panel';
import {
  RulesTabPanel,
  type LexRuleCreatePayload,
  type LexRuleUpdatePayload,
} from './rules-tab-panel';
import {
  ProfilesTabPanel,
  type LexProfileCreatePayload,
  type LexProfileUpdatePayload,
} from './profiles-tab-panel';
import {
  StopwordsTabPanel,
  type LexStopwordCreatePayload,
  type LexStopwordUpdatePayload,
} from './stopwords-tab-panel';
import { LexRunStartControls } from './lex-run-start-controls';
import type { LexConfirmOptions } from '../hooks/use-lex-confirm-modal';
import { LexCollapsibleJsonTree } from '../components/domain/LexCollapsibleJsonTree';

export type TermsListItem = Readonly<{
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

/** Query filters for GET /pim/lex/terms (status, domainCode, score range, text q). */
export type LexTermsListFilters = Readonly<{
  q: string;
  status: string;
  domainCode: string;
  minScore: string;
  maxScore: string;
}>;

/** Query filters for GET /pim/lex/review (status, severity, entityType, text q). */
export type LexReviewListFilters = Readonly<{
  q: string;
  status: string;
  severity: string;
  entityType: string;
}>;

/** Query filters for GET /pim/lex/publications (targetType, status, text q). */
export type LexPublicationsListFilters = Readonly<{
  q: string;
  status: string;
  targetType: string;
}>;

/** Query filters for GET /pim/lex/glossary (text q on source/target). */
export type LexGlossaryListFilters = Readonly<{
  q: string;
}>;

export type LexListLoadMore = Readonly<{
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}>;

/** Max length for optional review / governance decision notes (aligned with plan f4-16). */
export const LEX_DECISION_NOTES_MAX_LENGTH = 2000;

/** Entități acceptate de GET /pim/lex/export?format=csv&entity=… */
export type LexCsvExportEntity =
  | 'terms'
  | 'glossary'
  | 'translations'
  | 'rules'
  | 'review'
  | 'publications';

/** Item-uri deschise pentru Approve/Reject/Publish/Lock în UI (f4-19). */
export function lexReviewQueueActionsOpen(status: string): boolean {
  return status === 'pending' || status === 'in_review';
}

export function lexReviewQueueClosedHint(status: string): string {
  switch (status) {
    case 'approved':
      return 'Approved — no further actions available in queue.';
    case 'rejected':
      return 'Rejected — no further actions available.';
    case 'superseded':
      return 'Superseded by another item — no actions.';
    default:
      return `Status "${status}" — no actions in queue.`;
  }
}

export interface TabContentProps {
  activeTab: string;
  permissions: LexAccessPermissions;
  metrics: LexMetricsDto | null;
  runs: LexRunSummary[];
  terms: TermsListItem[];
  localizations: LexLocalizationDetail[];
  reviewItems: LexReviewItemDetail[];
  glossary: LexGlossaryEntryDto[];
  rules: LexTranslationRuleDto[];
  profiles: LexDomainProfileDto[];
  stopwords: LexStopwordDto[];
  governance: LexGovernanceRequestDto[];
  publications: LexPublicationTargetDto[];
  selectedTerm: LexTermDetail | null;
  /** GET /pim/lex/terms/:id/products — lista curentă pentru termenul selectat. */
  termAffectedProducts: LexTermAffectedProductDto[];
  selectedReview: LexReviewDetailDto | null;
  selectedPublication: LexPublicationDetailDto | null;
  settings: LexShopSettingsDto | null;
  /** True când formularul de setări diferă de ultima încărcare/salvare (f4-29). */
  settingsDirty: boolean;
  savingSettings: boolean;
  startingRun: boolean;
  resumingRunId: string | null;
  termFlagsSaving: boolean;
  manualTranslationSaving: boolean;
  editTranslationSaving: boolean;
  createManualLexTranslation: (payload: {
    translatedText: string;
    targetLang: string;
    clusterId?: string | null;
  }) => Promise<void>;
  editManualLexTranslation: (
    translationId: string,
    translatedText: string,
    notes?: string
  ) => Promise<void>;
  isRunStale: (run: LexRunSummary) => boolean;
  loadAll: () => Promise<void>;
  loadCurrentView: () => Promise<void>;
  handleStartRun: (runType: LexRunSummary['runType']) => Promise<void>;
  handleResumeRun: (runId: string) => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  selectTerm: (termId: string) => Promise<void>;
  updateTermFlags: (termId: string, patch: LexTermFlagsPatchRequest) => Promise<void>;
  selectReview: (reviewId: string) => Promise<void>;
  selectPublication: (publicationId: string) => Promise<void>;
  handleReviewDecision: (id: string, decisionType: 'approve' | 'reject') => Promise<void>;
  /** Selectare multiplă în coada de review (f4-22). */
  selectedReviewIdsForBulk: ReadonlySet<string>;
  toggleBulkReviewSelection: (reviewItemId: string) => void;
  selectAllActionableReviewsVisible: () => void;
  clearBulkReviewSelection: () => void;
  bulkReviewBusy: boolean;
  handleBulkReviewDecision: (decisionType: 'approve' | 'reject') => Promise<void>;
  handleAdvancedReviewDecision: (
    id: string,
    decisionType: 'publish' | 'lock_translation'
  ) => Promise<void>;
  handlePromoteToGovernance: (
    entityType: LexGovernanceRequestDto['entityType'],
    targetId: string,
    title: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
  handleGovernanceTransition: (
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'apply'
  ) => Promise<void>;
  handleRetryPublication: (id: string) => Promise<void>;
  handleRollbackPublication: (id: string) => Promise<void>;
  /** f5-02: rezolvare conflict publish (accept_lex = traducere Lex, keep_manual = păstrează magazinul). */
  handleResolvePublicationConflict: (
    id: string,
    resolution: 'accept_lex' | 'keep_manual'
  ) => Promise<void>;
  /** Optional notes for the next review decision (approve/reject/publish/lock). Cleared after success. */
  reviewDecisionNotes: string;
  setReviewDecisionNotes: Dispatch<SetStateAction<string>>;
  /** Optional notes for governance transitions (submit/approve/reject/apply). Cleared after success. */
  governanceActionNotes: string;
  setGovernanceActionNotes: Dispatch<SetStateAction<string>>;
  setTab: (value: string) => void;
  setSettings: Dispatch<SetStateAction<LexShopSettingsDto | null>>;
  /** Text brut din textarea „Extract scope JSON”; sincronizat la load/save în părinte (f4-25). */
  extractScopeText: string;
  setExtractScopeText: Dispatch<SetStateAction<string>>;
  refreshGlossary: () => Promise<void>;
  createGlossaryEntry: (payload: LexGlossaryCreatePayload) => Promise<void>;
  updateGlossaryEntry: (id: string, payload: LexGlossaryUpdatePayload) => Promise<void>;
  deleteGlossaryEntry: (id: string, expectedVersion: number) => Promise<void>;
  refreshRules: () => Promise<void>;
  createLexRule: (payload: LexRuleCreatePayload) => Promise<void>;
  updateLexRule: (id: string, payload: LexRuleUpdatePayload) => Promise<void>;
  deleteLexRule: (id: string, expectedVersion: number) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  createLexProfile: (payload: LexProfileCreatePayload) => Promise<void>;
  updateLexProfile: (id: string, payload: LexProfileUpdatePayload) => Promise<void>;
  deleteLexProfile: (id: string, expectedVersion: number) => Promise<void>;
  refreshStopwords: () => Promise<void>;
  createLexStopword: (payload: LexStopwordCreatePayload) => Promise<void>;
  updateLexStopword: (id: string, payload: LexStopwordUpdatePayload) => Promise<void>;
  deleteLexStopword: (id: string, expectedVersion: number) => Promise<void>;
  /** Modal confirm for destructive / high-impact actions (review, governance, publications, CRUD delete). */
  requestLexConfirm: (options: LexConfirmOptions, action: () => Promise<void>) => Promise<boolean>;
  /** Descarcă CSV per shop (filtrul q din tab-urile relevante este trimis automat). */
  handleDownloadLexCsvExport: (entity: LexCsvExportEntity) => Promise<void>;
  /** Descarcă XLIFF 2.0 per targetLang. */
  handleDownloadLexXliffExport: (targetLang: string) => Promise<void>;
  /** Importă un fișier XLIFF 2.0 cu traduceri. */
  handleImportXliff: (file: File) => Promise<void>;
  termsListFilters: LexTermsListFilters;
  onTermsFiltersInputChange: (q: string) => void;
  onTermsFiltersSearch: (q: string) => void;
  onTermsFilterImmediate: (patch: Partial<LexTermsListFilters>) => void;
  onTermsFilterDraft: (patch: Partial<LexTermsListFilters>) => void;
  onTermsFiltersReload: () => void;
  onClearTermsListFilters: () => void;
  reviewListFilters: LexReviewListFilters;
  onReviewFiltersInputChange: (q: string) => void;
  onReviewFiltersSearch: (q: string) => void;
  onReviewFilterImmediate: (patch: Partial<LexReviewListFilters>) => void;
  onClearReviewListFilters: () => void;
  publicationsListFilters: LexPublicationsListFilters;
  onPublicationsFiltersInputChange: (q: string) => void;
  onPublicationsFiltersSearch: (q: string) => void;
  onPublicationsFilterImmediate: (patch: Partial<LexPublicationsListFilters>) => void;
  onClearPublicationsListFilters: () => void;
  glossaryListFilters: LexGlossaryListFilters;
  onGlossaryFiltersInputChange: (q: string) => void;
  onGlossaryFiltersSearch: (q: string) => void;
  onClearGlossaryListFilters: () => void;
  lexLoadMore: Readonly<{
    overviewRuns: LexListLoadMore;
    overviewLocalizations: LexListLoadMore;
    runs: LexListLoadMore;
    terms: LexListLoadMore;
    review: LexListLoadMore;
    publications: LexListLoadMore;
    glossary: LexListLoadMore;
    rules: LexListLoadMore;
    profiles: LexListLoadMore;
    stopwords: LexListLoadMore;
    governance: LexListLoadMore;
    termProducts: LexListLoadMore;
  }>;
  /** g3-04: Guardrails statistics & recent events for the Settings tab. */
  guardrailsStats: LexGuardrailsStatsDto | null;
  guardrailsEvents: LexGuardrailsEventDto[];
  handleGuardrailsModeChange: (mode: LexGuardrailsMode) => Promise<void>;
  /** Datele tab-ului activ se încarcă (schimbare tab / reload parțial). */
  tabLoading: boolean;
}

function strRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type LexPublicationConflictLike = Readonly<{
  status: string;
  errorMessage?: string | null;
}>;

function publicationHasPublishConflict(
  item: LexPublicationConflictLike,
  events?: readonly { responsePayload: Record<string, unknown> }[]
): boolean {
  if (typeof item.status === 'string' && item.status.toLowerCase().includes('conflict')) {
    return true;
  }
  const em = item.errorMessage?.toLowerCase() ?? '';
  if (em.includes('publish_conflict')) return true;
  if (events) {
    for (const e of events) {
      const r = e.responsePayload['reason'];
      if (typeof r === 'string' && r.toLowerCase().includes('publish_conflict')) return true;
    }
  }
  return false;
}

function LexTranslationDiff({
  original,
  translated,
  leftCaption = 'Original',
  rightCaption = 'Translated',
}: Readonly<{
  original: string;
  translated: string;
  leftCaption?: string;
  rightCaption?: string;
}>) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900/60 dark:bg-red-950/40">
        <span className="text-xs font-medium text-red-600 dark:text-red-400">{leftCaption}</span>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{original}</p>
      </div>
      <div className="rounded border border-green-200 bg-green-50 p-2 text-sm dark:border-green-900/60 dark:bg-green-950/40">
        <span className="text-xs font-medium text-green-700 dark:text-green-400">
          {rightCaption}
        </span>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{translated}</p>
      </div>
    </div>
  );
}

function formatUnknownField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value).trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === 'object') {
    try {
      const s = JSON.stringify(value);
      return s.length > 0 ? s : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatProdTranslationSide(
  data: Record<string, unknown>,
  mode: 'snapshot' | 'payload'
): string {
  if (mode === 'snapshot') {
    if (data['exists'] === false) {
      return '(No translation row exists yet in prod_translations.)';
    }
    if (data['exists'] !== true && Object.keys(data).length === 0) {
      return '(Current store value not present in snapshot; check publish events.)';
    }
  }
  const titleRaw = mode === 'snapshot' ? data['title'] : (data['titleText'] ?? data['title']);
  const descriptionRaw =
    mode === 'snapshot' ? data['description'] : (data['descriptionText'] ?? data['description']);
  const lines: string[] = [];
  const title = formatUnknownField(titleRaw);
  const description = formatUnknownField(descriptionRaw);
  if (title) lines.push(`Title: ${title}`);
  if (description) lines.push(`Description: ${description}`);
  if (lines.length === 0) return '(Empty or unavailable in current source.)';
  return lines.join('\n\n');
}

function prodTranslationDiffFromPublication(
  detail: LexPublicationDetailDto
): { current: string; proposed: string } | null {
  if (detail.targetType !== 'prod_translations') return null;
  const payload = strRecord(detail.payload);
  if (typeof payload['productId'] !== 'string') return null;
  const prev = strRecord(detail.previousSnapshot);
  return {
    current: formatProdTranslationSide(prev, 'snapshot'),
    proposed: formatProdTranslationSide(payload, 'payload'),
  };
}

function shouldShowPublicationPreview(detail: LexPublicationDetailDto): boolean {
  if (detail.targetType !== 'prod_translations') return false;
  if (!['pending', 'publishing', 'failed'].includes(detail.status)) return false;
  const payload = strRecord(detail.payload);
  return typeof payload['productId'] === 'string';
}

function prodTranslationPreviewFromPublication(detail: LexPublicationDetailDto): {
  before: string;
  after: string;
} | null {
  const payload = strRecord(detail.payload);
  if (typeof payload['productId'] !== 'string') return null;
  const prev = strRecord(detail.previousSnapshot);
  const before = formatProdTranslationSide(prev, 'snapshot');
  const after = formatProdTranslationSide(payload, 'payload');
  return { before, after };
}

function formatOptionalPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

function formatOptionalSimilarity(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(3);
}

function lexResumeDeniedTitle(canManageSettings: boolean): string | undefined {
  if (canManageSettings) return undefined;
  return 'Resuming a run requires settings write / pipeline operation permission.';
}

function publicationListItemToneClass(selected: boolean, hasConflict: boolean): string {
  if (selected) {
    return 'rounded-xl border border-primary border-l-4 border-l-primary bg-primary/10 p-4 shadow-sm ring-1 ring-primary/25 transition-colors dark:bg-primary/15';
  }
  if (hasConflict) {
    return 'rounded-xl border border-amber-400/80 bg-amber-50/50 p-4 transition-colors dark:border-amber-700 dark:bg-amber-950/20';
  }
  return 'rounded-xl border border-border bg-card p-4 transition-colors';
}

export function collectUniqueDomainCodesFromProfiles(
  profiles: readonly LexDomainProfileDto[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of profiles) {
    const d = p.domainCode?.trim();
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function lexPublicationActionsDisabledTitle(disabled: boolean): string | undefined {
  return disabled ? 'Publishing is disabled (lex_publish_enabled).' : undefined;
}

const LEX_OVERVIEW_METRIC_DEFS: readonly {
  label: string;
  hint: string;
  valueOf: (m: LexMetricsDto | null) => string | number;
}[] = [
  { label: 'Runs', valueOf: (m) => m?.runsTotal ?? 0, hint: 'Total runs created' },
  { label: 'Terms', valueOf: (m) => m?.termsTotal ?? 0, hint: 'Available terms' },
  {
    label: 'Clusters',
    valueOf: (m) => (m?.clustersTotal ?? 0).toLocaleString(),
    hint: 'Total lex clusters',
  },
  {
    label: 'Glossary',
    valueOf: (m) => (m?.glossaryTotal ?? 0).toLocaleString(),
    hint: 'Glossary entries',
  },
  {
    label: 'Review Pending',
    valueOf: (m) => m?.reviewPending ?? 0,
    hint: 'Decisions awaiting approval',
  },
  {
    label: 'Review Backlog',
    valueOf: (m) => (m?.reviewBacklog ?? 0).toLocaleString(),
    hint: 'Review backlog (including pending)',
  },
  {
    label: 'Publications Pending',
    valueOf: (m) => (m?.publicationsPending ?? 0).toLocaleString(),
    hint: 'Publication targets in progress',
  },
  {
    label: 'Publications Failed',
    valueOf: (m) => (m?.publicationsFailed ?? 0).toLocaleString(),
    hint: 'Failed publications',
  },
  {
    label: 'Approved Localizations',
    valueOf: (m) => m?.localizationsApproved ?? 0,
    hint: 'Entities ready for publish',
  },
  {
    label: 'Runs Active',
    valueOf: (m) => m?.runsActive ?? 0,
    hint: 'Still active or paused runs',
  },
  {
    label: 'Runs Paused',
    valueOf: (m) => m?.runsPaused ?? 0,
    hint: 'Runs paused by budget, provider or manual intervention',
  },
  {
    label: 'Paused (budget)',
    valueOf: (m) => (m?.pausedBudgetBlocked ?? 0).toLocaleString(),
    hint: 'Runs paused due to budget',
  },
  {
    label: 'Paused (provider)',
    valueOf: (m) => (m?.pausedProviderUnavailable ?? 0).toLocaleString(),
    hint: 'Runs paused — provider unavailable',
  },
  {
    label: 'Shards Failed',
    valueOf: (m) => m?.shardsFailed ?? 0,
    hint: 'Shards terminated with error',
  },
  {
    label: 'Publish Conflicts',
    valueOf: (m) => m?.publishConflicts ?? 0,
    hint: 'Conflicts with manual targets or drift',
  },
  {
    label: 'Stale Checkpoints',
    valueOf: (m) => m?.staleCheckpoints ?? 0,
    hint: 'Stale heartbeats over 15 minutes',
  },
  {
    label: 'AI Backlog',
    valueOf: (m) => m?.aiBatchBacklog ?? 0,
    hint: 'Lex items still in AI batch processing',
  },
  { label: 'DLQ Entries', valueOf: (m) => m?.dlqEntries ?? 0, hint: 'Lex jobs stuck in DLQ' },
  {
    label: 'Workers Online',
    valueOf: (m) => (m == null ? 0 : `${m.workersOnline}/${m.workersTotal}`),
    hint: 'Active lex workers and schedulers',
  },
  {
    label: 'Retention Lag',
    valueOf: (m) => formatDurationSeconds(m?.retentionLag ?? 0),
    hint: 'Age of oldest hot fragment still retained',
  },
];

function LexOverviewMetricGrid(props: Readonly<{ metrics: LexMetricsDto | null }>) {
  const { metrics } = props;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {LEX_OVERVIEW_METRIC_DEFS.map((item) => (
        <Card key={item.label} padding="md" variant="bordered" className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">{item.label}</p>
          <p className="text-h3 text-foreground">{item.valueOf(metrics)}</p>
          <p className="text-sm text-muted">{item.hint}</p>
        </Card>
      ))}
    </div>
  );
}

function LexOverviewTranslationMemorySection(props: Readonly<{ metrics: LexMetricsDto | null }>) {
  const { metrics } = props;
  const hits = metrics?.tmHits ?? 0;
  const misses = metrics?.tmMisses ?? 0;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Translation Memory</h3>
        <p className="text-sm text-muted">
          Aggregated TM statistics from translation phases: hit rate, miss rate and average
          similarity.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card padding="md" variant="bordered" className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">TM Hit Rate</p>
          <p className="text-h3 text-foreground">
            {formatOptionalPercent(metrics?.tmHitRatePercent)}
          </p>
          <p className="text-sm text-muted">
            {hits} hits out of {hits + misses} lookups
          </p>
        </Card>
        <Card padding="md" variant="bordered" className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">TM Miss Rate</p>
          <p className="text-h3 text-foreground">
            {formatOptionalPercent(metrics?.tmMissRatePercent)}
          </p>
          <p className="text-sm text-muted">{misses} miss-uri din lookups totale</p>
        </Card>
        <Card padding="md" variant="bordered" className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Average Similarity</p>
          <p className="text-h3 text-foreground">
            {formatOptionalSimilarity(metrics?.tmAverageSimilarity)}
          </p>
          <p className="text-sm text-muted">Average cosine similarity (0–1) for TM hits</p>
        </Card>
      </div>
    </Card>
  );
}

function LexOverviewAlertsCard(
  props: Readonly<{
    metrics: LexMetricsDto | null;
    loadCurrentView: () => Promise<void>;
  }>
) {
  const { metrics, loadCurrentView } = props;
  const alerts = metrics?.alerts ?? [];
  const hasAlerts = alerts.length > 0;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">System Alerts</h3>
          <p className="text-sm text-muted">
            Operational signals powered by the same snapshot used by OTEL and PIM.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh current view"
          onClick={() => void loadCurrentView()}
        >
          Refresh
        </Button>
      </div>
      {hasAlerts ? (
        <div className="space-y-2">
          {alerts.map((alert) => (
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
                  <a className="text-xs font-semibold underline" href={withAppBasePath(alert.href)}>
                    Open
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No active lexical alerts"
          description="Pipeline, publish and retention appear healthy for the current shop."
        />
      )}
    </Card>
  );
}

function LexOverviewWorkersCard(props: Readonly<{ metrics: LexMetricsDto | null }>) {
  const { metrics } = props;
  const workers = metrics?.workers ?? [];
  const hasWorkers = workers.length > 0;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">Worker Health</h3>
      {hasWorkers ? (
        <div className="space-y-2">
          {workers.map((worker) => (
            <div key={worker.id} className="rounded-lg border border-border bg-card px-3 py-3">
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
                    className={`text-xs font-semibold ${worker.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
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
      ) : (
        <EmptyState
          title="No worker information available"
          description="Lex worker health will appear here after the first metrics refresh."
        />
      )}
    </Card>
  );
}

function LexOverviewQueueHealthCard(props: Readonly<{ metrics: LexMetricsDto | null }>) {
  const { metrics } = props;
  const queues = metrics?.queues ?? [];
  const hasQueues = queues.length > 0;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Queue Health</h3>
          <p className="text-sm text-muted">
            Backlog, failures and DLQ for each lexical phase, with deep links to the generic queue
            monitor.
          </p>
        </div>
        <a
          className="text-sm font-medium text-primary underline"
          href={withAppBasePath('/queues?tab=overview')}
        >
          Open Queue Monitor
        </a>
      </div>
      {hasQueues ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Queue health overview</caption>
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
              {queues.map((queue) => (
                <tr key={queue.name} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{queue.name}</td>
                  <td className="px-3 py-2 text-muted">{queue.waiting}</td>
                  <td className="px-3 py-2 text-muted">{queue.active}</td>
                  <td className="px-3 py-2 text-muted">{queue.delayed}</td>
                  <td className="px-3 py-2 text-muted">{queue.failed}</td>
                  <td className="px-3 py-2 text-muted">{queue.dlqEntries}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <a className="text-primary underline" href={withAppBasePath(queue.queueUrl)}>
                        Queue
                      </a>
                      <a className="text-primary underline" href={withAppBasePath(queue.dlqUrl)}>
                        DLQ
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No queue health available"
          description="Queue distribution and DLQ data will appear here after the first lexical snapshot."
        />
      )}
    </Card>
  );
}

function LexOverviewCsvExportCard(
  props: Readonly<{
    permissions: LexAccessPermissions;
    handleDownloadLexCsvExport: (entity: LexCsvExportEntity) => Promise<void>;
    termsListFilters: LexTermsListFilters;
    reviewListFilters: LexReviewListFilters;
    publicationsListFilters: LexPublicationsListFilters;
    glossaryListFilters: LexGlossaryListFilters;
  }>
) {
  const {
    permissions,
    handleDownloadLexCsvExport,
    termsListFilters,
    reviewListFilters,
    publicationsListFilters,
    glossaryListFilters,
  } = props;
  const [exportEntity, setExportEntity] = useState<LexCsvExportEntity>('terms');
  const [exportBusy, setExportBusy] = useState(false);
  const exportSelectValue =
    exportEntity === 'review' && !permissions.canReview ? 'terms' : exportEntity;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Export CSV</h3>
        <p className="text-sm text-muted">
          Download up to 25k rows per entity for the current shop. For Terms, Glossary, Review and
          Publications, the search field text of the respective tab is sent as parameter{' '}
          <code className="rounded bg-muted px-1">q</code> (if not empty).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="lex-csv-export-entity" className="sr-only">
          CSV export entity
        </label>
        <select
          id="lex-csv-export-entity"
          className="min-w-[12rem] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={exportSelectValue}
          onChange={(e) => setExportEntity(e.target.value as LexCsvExportEntity)}
        >
          <option value="terms">Terms {termsListFilters.q.trim() ? '(q active)' : ''}</option>
          <option value="glossary">
            Glossary {glossaryListFilters.q.trim() ? '(q active)' : ''}
          </option>
          <option value="translations">Translations</option>
          <option value="rules">Rules</option>
          {permissions.canReview ? (
            <option value="review">
              Review queue {reviewListFilters.q.trim() ? '(q active)' : ''}
            </option>
          ) : null}
          <option value="publications">
            Publications {publicationsListFilters.q.trim() ? '(q active)' : ''}
          </option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={exportBusy || (exportEntity === 'review' && !permissions.canReview)}
          onClick={() => {
            setExportBusy(true);
            void handleDownloadLexCsvExport(exportEntity).finally(() => setExportBusy(false));
          }}
        >
          {exportBusy ? 'Downloading…' : 'Download CSV'}
        </Button>
      </div>
    </Card>
  );
}

function LexOverviewXliffSection(
  props: Readonly<{
    settings: LexShopSettingsDto | null;
    handleDownloadLexXliffExport: (targetLang: string) => Promise<void>;
    handleImportXliff: (file: File) => Promise<void>;
  }>
) {
  const { settings, handleDownloadLexXliffExport, handleImportXliff } = props;
  const availableTargetLangs: string[] =
    settings?.targetLangs && settings.targetLangs.length > 0 ? settings.targetLangs : ['en'];
  const langsKey = settings?.targetLangs?.join('\u0001') ?? '';
  const [xliffTargetLang, setXliffTargetLang] = useState(availableTargetLangs[0] ?? 'en');
  const [xliffExportBusy, setXliffExportBusy] = useState(false);
  const [xliffImportBusy, setXliffImportBusy] = useState(false);

  useEffect(() => {
    const langs =
      settings?.targetLangs && settings.targetLangs.length > 0 ? settings.targetLangs : ['en'];
    const first = langs[0] ?? 'en';
    setXliffTargetLang((cur) => (langs.includes(cur) ? cur : first));
  }, [langsKey]);

  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-foreground">XLIFF 2.0</h3>
        <p className="text-sm text-muted">
          Export/Import translations in XLIFF 2.0 format — compatible with CAT tools (Trados, memoQ,
          Phrase etc.).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="lex-xliff-target-lang" className="text-sm text-foreground">
          Target language:
        </label>
        <select
          id="lex-xliff-target-lang"
          className="min-w-[8rem] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          value={xliffTargetLang}
          onChange={(e) => setXliffTargetLang(e.target.value)}
        >
          {availableTargetLangs.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={xliffExportBusy}
          onClick={() => {
            setXliffExportBusy(true);
            void handleDownloadLexXliffExport(xliffTargetLang).finally(() =>
              setXliffExportBusy(false)
            );
          }}
        >
          {xliffExportBusy ? 'Downloading…' : 'Export XLIFF'}
        </Button>
        <span className="mx-1 text-muted">|</span>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <span className="text-sm text-foreground">
            {xliffImportBusy ? 'Importing…' : 'Import XLIFF:'}
          </span>
          <input
            type="file"
            accept=".xliff,.xlf"
            className="text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-muted"
            disabled={xliffImportBusy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setXliffImportBusy(true);
                void handleImportXliff(file).finally(() => {
                  setXliffImportBusy(false);
                  e.target.value = '';
                });
              }
            }}
          />
        </label>
      </div>
    </Card>
  );
}

function LexOverviewLatestRunsSection(
  props: Readonly<{
    runs: LexRunSummary[];
    permissions: LexAccessPermissions;
    resumingRunId: string | null;
    handleResumeRun: (runId: string) => Promise<void>;
    loadAll: () => Promise<void>;
    lexLoadMoreRuns: LexListLoadMore;
  }>
) {
  const { runs, permissions, resumingRunId, handleResumeRun, loadAll, lexLoadMoreRuns } = props;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Latest Runs</h3>
        <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
          Refresh
        </Button>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          title="No lexical runs"
          description="Start the first rebuild to begin extraction, clustering and contextual translation."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Latest lexical runs</caption>
            <thead className="bg-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Pause</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Fragments</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Translations</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Start</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{run.runType}</td>
                  <td className="px-3 py-2 text-muted">{run.status}</td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs text-muted">
                    {run.status === 'paused' ? formatLexPauseReason(run.pauseReason) : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted">{run.fragmentsCount}</td>
                  <td className="px-3 py-2 text-muted">{run.translationsCount}</td>
                  <td className="px-3 py-2 text-muted">{formatDate(run.startedAt)}</td>
                  <td className="px-3 py-2">
                    {run.status === 'paused' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!permissions.canManageSettings || resumingRunId === run.id}
                        title={lexResumeDeniedTitle(permissions.canManageSettings)}
                        onClick={() => void handleResumeRun(run.id)}
                      >
                        {resumingRunId === run.id ? 'Resuming…' : 'Resume'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LexLoadMoreButton lm={lexLoadMoreRuns} />
    </Card>
  );
}

function LexOverviewApprovedLocalizationsSection(
  props: Readonly<{
    localizations: LexLocalizationDetail[];
    lexLoadMoreLocalizations: LexListLoadMore;
  }>
) {
  const { localizations, lexLoadMoreLocalizations } = props;
  return (
    <Card padding="md" variant="bordered" className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">Approved Localizations</h3>
      {localizations.length === 0 ? (
        <EmptyState
          title="No approved localizations"
          description="After review and composition, localizations ready for publish will appear here."
        />
      ) : (
        <div className="space-y-2">
          {localizations.map((item) => (
            <div key={item.id} className="rounded-lg border border-border bg-card/80 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {item.entityType} · {item.targetLang.toUpperCase()}
                  </p>
                  <p className="text-xs text-muted">
                    {item.titleText ?? item.descriptionShort ?? 'No publishable title'}
                  </p>
                </div>
                <span className="text-xs font-medium text-primary">{item.publicationStatus}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <LexLoadMoreButton lm={lexLoadMoreLocalizations} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1 – Overview                                                   */
/* ------------------------------------------------------------------ */
function LexLoadMoreButton({ lm }: Readonly<{ lm: LexListLoadMore }>) {
  if (!lm.hasMore) return null;
  return (
    <div className="flex justify-center pt-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={lm.loading}
        aria-busy={lm.loading}
        aria-label="Load more items"
        onClick={() => lm.onLoadMore()}
      >
        {lm.loading ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}

function LexOverviewTab(props: Readonly<TabContentProps>) {
  const {
    metrics,
    runs,
    localizations,
    loadAll,
    loadCurrentView,
    lexLoadMore,
    handleResumeRun,
    resumingRunId,
    permissions,
    handleDownloadLexCsvExport,
    handleDownloadLexXliffExport,
    handleImportXliff,
    termsListFilters,
    reviewListFilters,
    publicationsListFilters,
    glossaryListFilters,
    settings,
  } = props;

  return (
    <div className="space-y-4">
      <LexOverviewCsvExportCard
        permissions={permissions}
        handleDownloadLexCsvExport={handleDownloadLexCsvExport}
        termsListFilters={termsListFilters}
        reviewListFilters={reviewListFilters}
        publicationsListFilters={publicationsListFilters}
        glossaryListFilters={glossaryListFilters}
      />
      <LexOverviewXliffSection
        settings={settings}
        handleDownloadLexXliffExport={handleDownloadLexXliffExport}
        handleImportXliff={handleImportXliff}
      />
      <LexOverviewMetricGrid metrics={metrics} />
      <LexOverviewTranslationMemorySection metrics={metrics} />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_minmax(0,0.8fr)]">
        <LexOverviewAlertsCard metrics={metrics} loadCurrentView={loadCurrentView} />
        <LexOverviewWorkersCard metrics={metrics} />
      </div>
      <LexOverviewQueueHealthCard metrics={metrics} />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_minmax(0,1fr)]">
        <LexOverviewLatestRunsSection
          runs={runs}
          permissions={permissions}
          resumingRunId={resumingRunId}
          handleResumeRun={handleResumeRun}
          loadAll={loadAll}
          lexLoadMoreRuns={lexLoadMore.overviewRuns}
        />
        <LexOverviewApprovedLocalizationsSection
          localizations={localizations}
          lexLoadMoreLocalizations={lexLoadMore.overviewLocalizations}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2 – Runs                                                       */
/* ------------------------------------------------------------------ */
function renderRuns(props: TabContentProps) {
  const {
    runs,
    isRunStale,
    loadAll,
    handleStartRun,
    handleResumeRun,
    resumingRunId,
    permissions,
    startingRun,
    lexLoadMore,
  } = props;

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Execution Runs</h3>
          <p className="text-sm text-muted">Complete history for rebuilds and publish pipelines.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LexRunStartControls
            density="sm"
            canManageSettings={permissions.canManageSettings}
            startingRun={startingRun}
            onStart={handleStartRun}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh data"
            onClick={() => void loadAll()}
          >
            Refresh
          </Button>
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          title="No runs"
          description="Create the first lexical run to populate the term and sense inventory."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Execution runs</caption>
            <thead className="bg-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">Run</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Pause</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Terms</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Contexts</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Translations</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Error</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{run.runType}</div>
                    <div className="text-xs text-muted">{run.id}</div>
                  </td>
                  <td className={`px-3 py-2 ${runStatusClass(isRunStale(run), run.status)}`}>
                    {run.status}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs text-muted">
                    {run.status === 'paused' ? formatLexPauseReason(run.pauseReason) : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted">{run.termsCount}</td>
                  <td className="px-3 py-2 text-muted">{run.contextsCount}</td>
                  <td className="px-3 py-2 text-muted">{run.translationsCount}</td>
                  <td className="px-3 py-2 text-xs text-muted">{run.errorMessage ?? '—'}</td>
                  <td className="px-3 py-2">
                    {run.status === 'paused' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!permissions.canManageSettings || resumingRunId === run.id}
                        title={lexResumeDeniedTitle(permissions.canManageSettings)}
                        onClick={() => void handleResumeRun(run.id)}
                      >
                        {resumingRunId === run.id ? 'Resuming…' : 'Resume'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LexLoadMoreButton lm={lexLoadMore.runs} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Manual Translation Block (inside Term Detail)                      */
/* ------------------------------------------------------------------ */
function LexTermManualTranslationBlock(
  props: Readonly<{
    selectedTerm: LexTermDetail | null;
    settings: LexShopSettingsDto | null;
    manualTranslationSaving: boolean;
    createManualLexTranslation: (payload: {
      translatedText: string;
      targetLang: string;
      clusterId?: string | null;
    }) => Promise<void>;
  }>
) {
  const { selectedTerm, settings, manualTranslationSaving, createManualLexTranslation } = props;
  const [translatedText, setTranslatedText] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');
  const [targetLang, setTargetLang] = useState('');

  useEffect(() => {
    setTranslatedText('');
    setSelectedClusterId('');
    setTargetLang('');
  }, [selectedTerm?.id]);

  if (!selectedTerm) return null;

  const shopTargetLangs = settings?.targetLangs;
  const firstShopTargetLang = shopTargetLangs?.[0] ?? '';
  const effectiveTargetLang = targetLang.length > 0 ? targetLang : firstShopTargetLang;
  const canSave =
    translatedText.trim().length > 0 && effectiveTargetLang.length > 0 && !manualTranslationSaving;

  const handleSave = async () => {
    if (!canSave) return;
    await createManualLexTranslation({
      translatedText: translatedText.trim(),
      targetLang: effectiveTargetLang,
      clusterId: selectedClusterId.length > 0 ? selectedClusterId : null,
    });
    setTranslatedText('');
  };

  const clusters = selectedTerm.clusters ?? [];
  const availableTargetLangs: string[] = shopTargetLangs ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/60 p-4">
      <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
        Manual Translation
      </h5>
      <p className="text-xs text-muted">
        Add a manual translation for term "{selectedTerm.canonicalText}". Manual translations have
        confidence 0.95 and are marked as approved.
      </p>

      {clusters.length > 0 ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Sense cluster (optional)</span>
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
          >
            <option value="">— no specific cluster —</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelRo ?? c.clusterKey}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {availableTargetLangs.length > 1 ? (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Target language</span>
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={targetLang.length > 0 ? targetLang : firstShopTargetLang}
            onChange={(e) => setTargetLang(e.target.value)}
          >
            {availableTargetLangs.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-xs text-muted">
          Target language:{' '}
          <strong>{effectiveTargetLang.length > 0 ? effectiveTargetLang : '—'}</strong>
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Translated text</span>
        <textarea
          rows={2}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted"
          placeholder="Enter manual translation..."
          value={translatedText}
          onChange={(e) => setTranslatedText(e.target.value)}
        />
      </label>

      <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
        {manualTranslationSaving ? 'Saving…' : 'Save translation'}
      </Button>
    </div>
  );
}

function LexTermsInventoryFiltersBar(
  props: Readonly<{
    termsListFilters: LexTermsListFilters;
    domainOptions: readonly string[];
    hasActiveTermFilters: boolean;
    onTermsFiltersInputChange: TabContentProps['onTermsFiltersInputChange'];
    onTermsFiltersSearch: TabContentProps['onTermsFiltersSearch'];
    onTermsFilterImmediate: TabContentProps['onTermsFilterImmediate'];
    onTermsFilterDraft: TabContentProps['onTermsFilterDraft'];
    onTermsFiltersReload: TabContentProps['onTermsFiltersReload'];
    onClearTermsListFilters: TabContentProps['onClearTermsListFilters'];
  }>
) {
  const {
    termsListFilters,
    domainOptions,
    hasActiveTermFilters,
    onTermsFiltersInputChange,
    onTermsFiltersSearch,
    onTermsFilterImmediate,
    onTermsFilterDraft,
    onTermsFiltersReload,
    onClearTermsListFilters,
  } = props;
  return (
    <div className="space-y-3 rounded-md border border-border bg-subtle/40 p-3">
      <SearchInput
        label="Search terms"
        placeholder="Canonical text or normalized key…"
        value={termsListFilters.q}
        onChange={onTermsFiltersInputChange}
        onSearch={onTermsFiltersSearch}
        debounceMs={300}
        className="max-w-xl"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Status</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={termsListFilters.status}
            onChange={(e) => onTermsFilterImmediate({ status: e.target.value })}
          >
            <option value="">All</option>
            <option value="active">active</option>
            <option value="stopped">stopped</option>
            <option value="merged">merged</option>
          </select>
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Domain</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={termsListFilters.domainCode}
            onChange={(e) => onTermsFilterImmediate({ domainCode: e.target.value })}
          >
            <option value="">All</option>
            <option value="__none__">No domain</option>
            {domainOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-[100px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Min score</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0–1"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={termsListFilters.minScore}
            onChange={(e) => onTermsFilterDraft({ minScore: e.target.value })}
            onBlur={() => onTermsFiltersReload()}
          />
        </label>
        <label className="flex w-[100px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Max score</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0–1"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={termsListFilters.maxScore}
            onChange={(e) => onTermsFilterDraft({ maxScore: e.target.value })}
            onBlur={() => onTermsFiltersReload()}
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={!hasActiveTermFilters}
          onClick={() => onClearTermsListFilters()}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function LexReviewQueueFiltersBar(
  props: Readonly<{
    reviewListFilters: LexReviewListFilters;
    hasActiveReviewFilters: boolean;
    onReviewFiltersInputChange: TabContentProps['onReviewFiltersInputChange'];
    onReviewFiltersSearch: TabContentProps['onReviewFiltersSearch'];
    onReviewFilterImmediate: TabContentProps['onReviewFilterImmediate'];
    onClearReviewListFilters: TabContentProps['onClearReviewListFilters'];
  }>
) {
  const {
    reviewListFilters,
    hasActiveReviewFilters,
    onReviewFiltersInputChange,
    onReviewFiltersSearch,
    onReviewFilterImmediate,
    onClearReviewListFilters,
  } = props;
  return (
    <div className="space-y-3 rounded-md border border-border bg-subtle/40 p-3">
      <SearchInput
        label="Search review"
        placeholder="Reason, notes or entity ID…"
        value={reviewListFilters.q}
        onChange={onReviewFiltersInputChange}
        onSearch={onReviewFiltersSearch}
        debounceMs={300}
        className="max-w-xl"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Status</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={reviewListFilters.status}
            onChange={(e) => onReviewFilterImmediate({ status: e.target.value })}
          >
            <option value="">All</option>
            {LEX_REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Severity</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={reviewListFilters.severity}
            onChange={(e) => onReviewFilterImmediate({ severity: e.target.value })}
          >
            <option value="">All</option>
            {LEX_REVIEW_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Entity type</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={reviewListFilters.entityType}
            onChange={(e) => onReviewFilterImmediate({ entityType: e.target.value })}
          >
            <option value="">All</option>
            {LEX_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={!hasActiveReviewFilters}
          onClick={() => onClearReviewListFilters()}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function LexTermsInventoryBody(
  props: Readonly<{
    terms: readonly TermsListItem[];
    selectedTermId: string | undefined;
    selectTerm: (termId: string) => Promise<void>;
    hasActiveTermFilters: boolean;
  }>
) {
  const { terms, selectedTermId, selectTerm, hasActiveTermFilters } = props;
  if (terms.length === 0) {
    return (
      <EmptyState
        title={hasActiveTermFilters ? 'No results' : 'Empty inventory'}
        description={
          hasActiveTermFilters
            ? 'Try different filters or clear the search.'
            : 'After fragment extraction and term mining, terms will appear here.'
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-subtle">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted">Term</th>
            <th className="px-3 py-2 text-left font-medium text-muted">Type</th>
            <th className="px-3 py-2 text-left font-medium text-muted">Occ.</th>
            <th className="px-3 py-2 text-left font-medium text-muted">Score</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((term) => (
            <tr
              key={term.id}
              className={`cursor-pointer border-t border-border transition-colors ${
                selectedTermId === term.id
                  ? 'border-l-2 border-l-primary bg-primary/10 hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20'
                  : 'hover:bg-subtle'
              }`}
              onClick={() => void selectTerm(term.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void selectTerm(term.id);
                }
              }}
              tabIndex={0}
              aria-label={`View term: ${term.canonicalText}`}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">{term.canonicalText}</div>
                <div className="text-xs text-muted">
                  {term.domainCode ?? 'no domain'}
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
  );
}

function LexTermDetailPanel(
  props: Readonly<{
    selectedTerm: LexTermDetail | null;
    termAffectedProducts: readonly LexTermAffectedProductDto[];
    updateTermFlags: TabContentProps['updateTermFlags'];
    termFlagsSaving: boolean;
    lexLoadMoreTermProducts: LexListLoadMore;
    manualTranslationSaving: boolean;
    createManualLexTranslation: TabContentProps['createManualLexTranslation'];
    settings: LexShopSettingsDto | null;
  }>
) {
  const {
    selectedTerm,
    termAffectedProducts,
    updateTermFlags,
    termFlagsSaving,
    lexLoadMoreTermProducts,
    manualTranslationSaving,
    createManualLexTranslation,
    settings,
  } = props;
  if (!selectedTerm) {
    return (
      <EmptyState
        title="Select a term"
        description="View variants, senses and approved clusters for the selected term here."
      />
    );
  }
  return (
    <>
      <div className="rounded-lg border border-border bg-subtle/60 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">{selectedTerm.termType}</p>
        <h4 className="mt-1 text-xl font-semibold text-foreground">{selectedTerm.canonicalText}</h4>
        <p className="mt-1 text-sm text-muted">
          Key: {selectedTerm.normalizedKey} · ngram {selectedTerm.ngramSize} · {selectedTerm.status}
          {selectedTerm.domainCode != null && selectedTerm.domainCode !== ''
            ? ` · domain ${selectedTerm.domainCode}`
            : ''}
        </p>
        {selectedTerm.displayTextRo != null && selectedTerm.displayTextRo.trim() !== '' ? (
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-foreground">Display (RO): </span>
            {selectedTerm.displayTextRo}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Occurrences (shop): {selectedTerm.occurrencesTotal.toLocaleString()} · Global score:{' '}
          {selectedTerm.scoreGlobal == null ? '—' : formatScore(selectedTerm.scoreGlobal)}
        </p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card/40 px-3 py-3">
        <Checkbox
          label="Technical term"
          checked={selectedTerm.isTechnical}
          disabled={termFlagsSaving}
          onChange={(e) => void updateTermFlags(selectedTerm.id, { isTechnical: e.target.checked })}
        />
        <Checkbox
          label="Protected (brand / do not translate)"
          checked={selectedTerm.isProtected}
          disabled={termFlagsSaving}
          onChange={(e) => void updateTermFlags(selectedTerm.id, { isProtected: e.target.checked })}
        />
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Variants</h5>
        {selectedTerm.variants.length === 0 ? (
          <EmptyState
            title="No variants"
            description="No approved or extracted variants exist yet for this term."
          />
        ) : (
          <div className="space-y-2">
            {selectedTerm.variants.map((variant) => (
              <div
                key={variant.id}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{variant.variantText}</span>
                  <span className="text-xs text-muted">
                    {variant.locale} · {variant.variantType}
                    {variant.isPreferred ? ' · preferred' : ''}
                    {variant.isApproved ? ' · approved' : ' · pending'}
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
          <EmptyState
            title="No sense clusters"
            description="After clustering, approved or under-review senses will appear here."
          />
        ) : (
          <div className="space-y-2">
            {selectedTerm.clusters.map((cluster) => (
              <div key={cluster.id} className="rounded-lg border border-border bg-card px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {cluster.labelRo ?? cluster.clusterKey}
                    </p>
                    <p className="text-xs text-muted">
                      {cluster.clusterMethod} · {cluster.domainCode ?? 'no domain'} · scor{' '}
                      {formatScore(cluster.confidenceScore)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-primary">
                    {clusterStatusLabel(cluster.isApproved, cluster.needsReview)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
          Affected Products
        </h5>
        {termAffectedProducts.length === 0 ? (
          <EmptyState
            title="No linked products"
            description="No products are linked via fragments (product_id) for this term in current data."
          />
        ) : (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Affected products</caption>
                <thead className="bg-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted">Titlu</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Handle</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                    <th className="px-3 py-2 text-right font-medium text-muted">Occ.</th>
                  </tr>
                </thead>
                <tbody>
                  {termAffectedProducts.map((row) => (
                    <tr key={row.productId} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{row.title || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {row.handle || '—'}
                      </td>
                      <td className="px-3 py-2 text-muted">{row.status ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-muted">{row.occurrenceCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LexLoadMoreButton lm={lexLoadMoreTermProducts} />
          </div>
        )}
      </div>

      <LexTermManualTranslationBlock
        selectedTerm={selectedTerm}
        settings={settings}
        manualTranslationSaving={manualTranslationSaving}
        createManualLexTranslation={createManualLexTranslation}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3 – Terms                                                      */
/* ------------------------------------------------------------------ */
function renderTerms(props: TabContentProps) {
  const {
    terms,
    profiles,
    selectedTerm,
    termAffectedProducts,
    selectTerm,
    updateTermFlags,
    termFlagsSaving,
    loadAll,
    lexLoadMore,
    termsListFilters,
    onTermsFiltersInputChange,
    onTermsFiltersSearch,
    onTermsFilterImmediate,
    onTermsFilterDraft,
    onTermsFiltersReload,
    onClearTermsListFilters,
    manualTranslationSaving,
    createManualLexTranslation,
    settings,
  } = props;

  const domainOptions = collectUniqueDomainCodesFromProfiles(profiles);

  const hasActiveTermFilters =
    termsListFilters.q.trim() !== '' ||
    termsListFilters.status !== '' ||
    termsListFilters.domainCode !== '' ||
    termsListFilters.minScore.trim() !== '' ||
    termsListFilters.maxScore.trim() !== '';

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
      <Card padding="md" variant="bordered" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-foreground">Term Inventory</h3>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh data"
            onClick={() => void loadAll()}
          >
            Refresh
          </Button>
        </div>

        <LexTermsInventoryFiltersBar
          termsListFilters={termsListFilters}
          domainOptions={domainOptions}
          hasActiveTermFilters={hasActiveTermFilters}
          onTermsFiltersInputChange={onTermsFiltersInputChange}
          onTermsFiltersSearch={onTermsFiltersSearch}
          onTermsFilterImmediate={onTermsFilterImmediate}
          onTermsFilterDraft={onTermsFilterDraft}
          onTermsFiltersReload={onTermsFiltersReload}
          onClearTermsListFilters={onClearTermsListFilters}
        />

        <LexTermsInventoryBody
          terms={terms}
          selectedTermId={selectedTerm?.id}
          selectTerm={selectTerm}
          hasActiveTermFilters={hasActiveTermFilters}
        />
        <LexLoadMoreButton lm={lexLoadMore.terms} />
      </Card>

      <Card padding="md" variant="bordered" className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Term Detail</h3>
        <LexTermDetailPanel
          selectedTerm={selectedTerm}
          termAffectedProducts={termAffectedProducts}
          updateTermFlags={updateTermFlags}
          termFlagsSaving={termFlagsSaving}
          lexLoadMoreTermProducts={lexLoadMore.termProducts}
          manualTranslationSaving={manualTranslationSaving}
          createManualLexTranslation={createManualLexTranslation}
          settings={settings}
        />
      </Card>
    </div>
  );
}

function LexReviewDecisionNotesPanel(
  props: Readonly<{
    reviewDecisionNotes: string;
    setReviewDecisionNotes: TabContentProps['setReviewDecisionNotes'];
  }>
) {
  const { reviewDecisionNotes, setReviewDecisionNotes } = props;
  return (
    <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
      <label htmlFor="lex-review-decision-notes" className="text-xs font-medium text-muted">
        Optional notes for decisions (approve, reject, publish, lock){' '}
        <span className="font-normal text-muted/80">
          — max {LEX_DECISION_NOTES_MAX_LENGTH} characters
        </span>
      </label>
      <textarea
        id="lex-review-decision-notes"
        className="min-h-[72px] w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-card"
        maxLength={LEX_DECISION_NOTES_MAX_LENGTH}
        value={reviewDecisionNotes}
        onChange={(e) => setReviewDecisionNotes(e.target.value)}
        placeholder="Select the highlighted review row first to attach custom notes. If empty, a short default note is sent."
        aria-describedby="lex-review-decision-notes-counter"
      />
      <p id="lex-review-decision-notes-counter" className="text-right text-xs text-muted">
        {reviewDecisionNotes.length}/{LEX_DECISION_NOTES_MAX_LENGTH}
      </p>
    </div>
  );
}

function LexReviewBulkToolbar(
  props: Readonly<{
    reviewItemsCount: number;
    bulkSelectionCount: number;
    actionableCount: number;
    allActionableSelected: boolean;
    bulkReviewBusy: boolean;
    permissions: LexAccessPermissions;
    selectAllActionableReviewsVisible: () => void;
    clearBulkReviewSelection: () => void;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleBulkReviewDecision: TabContentProps['handleBulkReviewDecision'];
  }>
) {
  const {
    reviewItemsCount,
    bulkSelectionCount,
    actionableCount,
    allActionableSelected,
    bulkReviewBusy,
    permissions,
    selectAllActionableReviewsVisible,
    clearBulkReviewSelection,
    requestLexConfirm,
    handleBulkReviewDecision,
  } = props;
  if (reviewItemsCount === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card/40 p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <p className="text-xs font-medium text-muted">
        Bulk actions (approve/reject){' '}
        <span className="font-normal text-muted/80">
          — {bulkSelectionCount} selected · {actionableCount} open in list
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={
            !permissions.canReview ||
            bulkReviewBusy ||
            actionableCount === 0 ||
            allActionableSelected
          }
          onClick={() => selectAllActionableReviewsVisible()}
        >
          Select all open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={bulkReviewBusy || bulkSelectionCount === 0}
          onClick={() => clearBulkReviewSelection()}
        >
          Clear selection
        </Button>
        <Button
          size="sm"
          disabled={!permissions.canReview || bulkReviewBusy || bulkSelectionCount === 0}
          title={
            permissions.canReview
              ? 'Approve all checked items'
              : 'You do not have review permission.'
          }
          aria-label="Bulk approve selected review items"
          onClick={() =>
            void requestLexConfirm(
              {
                title: `Aprobi ${bulkSelectionCount} item-uri de review?`,
                description: (
                  <span>
                    The same optional note from the textarea (or the default bulk message) is
                    applied per item. Items with stale versions will fail individually.
                  </span>
                ),
                confirmLabel: bulkReviewBusy ? 'Processing…' : 'Bulk approve',
                confirmVariant: 'primary',
              },
              () => handleBulkReviewDecision('approve')
            )
          }
        >
          {bulkReviewBusy ? 'Processing…' : 'Bulk approve'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!permissions.canReview || bulkReviewBusy || bulkSelectionCount === 0}
          aria-label="Bulk reject selected review items"
          onClick={() =>
            void requestLexConfirm(
              {
                title: `Respingi ${bulkSelectionCount} item-uri de review?`,
                description: (
                  <span>The operation may partially succeed if some versions no longer match.</span>
                ),
                confirmLabel: bulkReviewBusy ? 'Processing…' : 'Bulk reject',
                confirmVariant: 'destructive',
              },
              () => handleBulkReviewDecision('reject')
            )
          }
        >
          {bulkReviewBusy ? 'Processing…' : 'Bulk reject'}
        </Button>
      </div>
    </div>
  );
}

function LexReviewQueueItemCard(
  props: Readonly<{
    item: LexReviewItemDetail;
    selected: boolean;
    selectedReviewIdsForBulk: ReadonlySet<string>;
    permissions: LexAccessPermissions;
    bulkReviewBusy: boolean;
    selectReview: (id: string) => Promise<void>;
    toggleBulkReviewSelection: (id: string) => void;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleReviewDecision: TabContentProps['handleReviewDecision'];
    handleAdvancedReviewDecision: TabContentProps['handleAdvancedReviewDecision'];
  }>
) {
  const {
    item,
    selected,
    selectedReviewIdsForBulk,
    permissions,
    bulkReviewBusy,
    selectReview,
    toggleBulkReviewSelection,
    requestLexConfirm,
    handleReviewDecision,
    handleAdvancedReviewDecision,
  } = props;
  const actionsOpen = lexReviewQueueActionsOpen(item.status);
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        selected
          ? 'border-primary border-l-4 border-l-primary bg-primary/10 shadow-sm ring-1 ring-primary/25 dark:bg-primary/15'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex shrink-0 pt-0.5">
          <Checkbox
            checked={selectedReviewIdsForBulk.has(item.id)}
            disabled={
              !permissions.canReview || bulkReviewBusy || !lexReviewQueueActionsOpen(item.status)
            }
            onChange={() => toggleBulkReviewSelection(item.id)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Select for bulk action: review ${item.entityType} ${item.entityId}`}
            className="!items-center"
          />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 space-y-1 text-left"
          onClick={() => void selectReview(item.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void selectReview(item.id);
            }
          }}
        >
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            {item.entityType} · {item.reviewReason}
          </p>
          <p className="font-medium text-foreground">{item.entityId}</p>
          <p className="text-sm text-muted">
            Severity {item.severity} · priority {item.priority} · status {item.status}
          </p>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {actionsOpen ? (
            <>
              <Button
                size="sm"
                disabled={!permissions.canReview}
                title={
                  permissions.canReview
                    ? 'Approve this review item'
                    : 'You do not have review permission for this shop.'
                }
                aria-label={`Approve review ${item.entityId}`}
                onClick={() =>
                  void requestLexConfirm(
                    {
                      title: 'Approve this review item?',
                      description: (
                        <span>
                          {item.entityType} · {item.reviewReason}
                          <br />
                          <span className="font-mono text-xs">{item.entityId}</span>
                        </span>
                      ),
                      confirmLabel: 'Approve',
                      confirmVariant: 'primary',
                    },
                    () => handleReviewDecision(item.id, 'approve')
                  )
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!permissions.canReview}
                title={
                  permissions.canReview
                    ? 'Reject this item'
                    : 'You do not have review permission for this shop.'
                }
                aria-label={`Reject review ${item.entityId}`}
                onClick={() =>
                  void requestLexConfirm(
                    {
                      title: 'Reject this review item?',
                      description: (
                        <span>
                          The item will be marked rejected and removed from the active queue.
                          <br />
                          <span className="font-mono text-xs">{item.entityId}</span>
                        </span>
                      ),
                      confirmLabel: 'Reject',
                      confirmVariant: 'destructive',
                    },
                    () => handleReviewDecision(item.id, 'reject')
                  )
                }
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!permissions.canPublish}
                title={
                  permissions.canPublish
                    ? 'Trigger publication for linked targets'
                    : 'You do not have publish permission for this shop.'
                }
                aria-label={`Publish from review ${item.entityId}`}
                onClick={() =>
                  void requestLexConfirm(
                    {
                      title: 'Publish from this review item?',
                      description:
                        'Triggers publication workflow for linked targets. Confirm only if the resolution is final.',
                      confirmLabel: 'Publish',
                      confirmVariant: 'primary',
                    },
                    () => handleAdvancedReviewDecision(item.id, 'publish')
                  )
                }
              >
                Publish
              </Button>
              {item.entityType === 'translation' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!permissions.canReview}
                  title={
                    permissions.canReview
                      ? 'Lock translation from automated changes'
                      : 'You do not have review permission for this shop.'
                  }
                  aria-label={`Lock translation for review ${item.entityId}`}
                  onClick={() =>
                    void requestLexConfirm(
                      {
                        title: 'Lock this translation?',
                        description:
                          'Locked translations skip automated changes until manually unlocked in backend workflows.',
                        confirmLabel: 'Lock',
                        confirmVariant: 'destructive',
                      },
                      () => handleAdvancedReviewDecision(item.id, 'lock_translation')
                    )
                  }
                >
                  Lock
                </Button>
              ) : null}
            </>
          ) : (
            <p
              className="max-w-[220px] text-xs text-muted"
              title={lexReviewQueueClosedHint(item.status)}
            >
              {lexReviewQueueClosedHint(item.status)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LexReviewDetailPanel(
  props: Readonly<{
    selectedReview: LexReviewDetailDto | null;
    setTab: TabContentProps['setTab'];
    selectPublication: (id: string) => Promise<void>;
  }>
) {
  const { selectedReview, setTab, selectPublication } = props;
  if (!selectedReview) {
    return (
      <EmptyState
        title="Select a review item"
        description="Evidence, decision timeline and publication impact will appear here."
      />
    );
  }
  return (
    <>
      <div className="rounded-lg border border-border bg-subtle/60 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">
          {selectedReview.entityType} · {selectedReview.reviewReason}
        </p>
        <h4 className="mt-1 text-xl font-semibold text-foreground">{selectedReview.entityId}</h4>
        <p className="mt-1 text-sm text-muted">
          status {selectedReview.status} · severity {selectedReview.severity} · priority{' '}
          {selectedReview.priority}
        </p>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-foreground">Assigned: </span>
          {selectedReview.assignedTo ?? '-'}
        </p>
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Timeline</h5>
        {selectedReview.timeline.length === 0 ? (
          <EmptyState
            title="Empty timeline"
            description="No timeline events exist for this review item."
          />
        ) : (
          <div className="space-y-2">
            {selectedReview.timeline.map((ev) => (
              <div key={ev.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {ev.kind} · {ev.action}
                    {ev.status != null && ev.status !== '' ? ` · ${ev.status}` : ''}
                  </span>
                  <span className="text-xs text-muted">
                    {ev.createdAt ? new Date(ev.createdAt).toLocaleDateString() : '-'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">actor: {ev.actorId ?? '-'}</p>
                <div className="mt-2">
                  <LexCollapsibleJsonTree value={ev.details} title="Details" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
          Related Localizations
        </h5>
        {selectedReview.relatedLocalizations.length === 0 ? (
          <EmptyState
            title="No related localizations"
            description="No localizations linked to this item in current data."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Related localizations</caption>
              <thead className="border-b border-border bg-subtle/50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Limba</th>
                  <th className="px-3 py-2">Pub. status</th>
                  <th className="px-3 py-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {selectedReview.relatedLocalizations.map((loc) => (
                  <tr key={loc.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{loc.id}</td>
                    <td className="px-3 py-2">
                      {loc.entityType} · {loc.entityId}
                    </td>
                    <td className="px-3 py-2">{loc.targetLang}</td>
                    <td className="px-3 py-2">{loc.publicationStatus}</td>
                    <td className="px-3 py-2">
                      {loc.qualityScore == null ? '-' : formatScore(loc.qualityScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Evidence</h5>
        <LexCollapsibleJsonTree value={selectedReview.evidence} />
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Decisions</h5>
        {selectedReview.decisions.length === 0 ? (
          <EmptyState
            title="No recorded decisions"
            description="No decisions saved yet for this review item."
          />
        ) : (
          <div className="space-y-2">
            {selectedReview.decisions.map((decision) => (
              <div key={decision.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{decision.decisionType}</span>
                  <span className="text-xs text-muted">
                    {decision.createdAt ? new Date(decision.createdAt).toLocaleDateString() : '-'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{decision.decisionNotes ?? 'No notes.'}</p>
                <p className="mt-2 text-xs text-muted">
                  <span className="font-medium text-foreground">Decided by: </span>
                  {decision.decidedBy?.trim() ? decision.decidedBy : '—'}
                </p>
                <div className="mt-2 space-y-2">
                  {Object.keys(decision.oldValue).length > 0 ? (
                    <LexCollapsibleJsonTree value={decision.oldValue} title="Previous value" />
                  ) : (
                    <p className="text-xs text-muted">
                      <span className="font-medium text-foreground">Previous value: </span>—
                    </p>
                  )}
                  {Object.keys(decision.newValue).length > 0 ? (
                    <LexCollapsibleJsonTree value={decision.newValue} title="New value" />
                  ) : (
                    <p className="text-xs text-muted">
                      <span className="font-medium text-foreground">New value: </span>—
                    </p>
                  )}
                </div>
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
          <EmptyState
            title="No publication targets"
            description="No publication targets linked to this review item."
          />
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
                <span className="font-medium text-foreground">{publication.targetType}</span>
                <span className="text-xs text-muted">{publication.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 4 – Review                                                     */
/* ------------------------------------------------------------------ */
function renderReview(props: TabContentProps) {
  const {
    reviewItems,
    selectedReview,
    selectReview,
    selectPublication,
    loadAll,
    handleReviewDecision,
    handleAdvancedReviewDecision,
    selectedReviewIdsForBulk,
    toggleBulkReviewSelection,
    selectAllActionableReviewsVisible,
    clearBulkReviewSelection,
    bulkReviewBusy,
    handleBulkReviewDecision,
    requestLexConfirm,
    setTab,
    lexLoadMore,
    reviewListFilters,
    onReviewFiltersInputChange,
    onReviewFiltersSearch,
    onReviewFilterImmediate,
    onClearReviewListFilters,
    reviewDecisionNotes,
    setReviewDecisionNotes,
    permissions,
  } = props;

  const hasActiveReviewFilters =
    reviewListFilters.q.trim() !== '' ||
    reviewListFilters.status !== '' ||
    reviewListFilters.severity !== '' ||
    reviewListFilters.entityType !== '';

  const actionableReviewIds = reviewItems
    .filter((i) => lexReviewQueueActionsOpen(i.status))
    .map((i) => i.id);
  const actionableCount = actionableReviewIds.length;
  const bulkSelectionCount = selectedReviewIdsForBulk.size;
  const allActionableSelected =
    actionableCount > 0 && actionableReviewIds.every((id) => selectedReviewIdsForBulk.has(id));

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
      <Card padding="md" variant="bordered" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Review Queue</h3>
            <p className="text-sm text-muted">
              Ambiguous cases, rule conflicts and low-confidence results.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh data"
            onClick={() => void loadAll()}
          >
            Refresh
          </Button>
        </div>

        <LexReviewQueueFiltersBar
          reviewListFilters={reviewListFilters}
          hasActiveReviewFilters={hasActiveReviewFilters}
          onReviewFiltersInputChange={onReviewFiltersInputChange}
          onReviewFiltersSearch={onReviewFiltersSearch}
          onReviewFilterImmediate={onReviewFilterImmediate}
          onClearReviewListFilters={onClearReviewListFilters}
        />

        <LexReviewDecisionNotesPanel
          reviewDecisionNotes={reviewDecisionNotes}
          setReviewDecisionNotes={setReviewDecisionNotes}
        />

        <LexReviewBulkToolbar
          reviewItemsCount={reviewItems.length}
          bulkSelectionCount={bulkSelectionCount}
          actionableCount={actionableCount}
          allActionableSelected={allActionableSelected}
          bulkReviewBusy={bulkReviewBusy}
          permissions={permissions}
          selectAllActionableReviewsVisible={selectAllActionableReviewsVisible}
          clearBulkReviewSelection={clearBulkReviewSelection}
          requestLexConfirm={requestLexConfirm}
          handleBulkReviewDecision={handleBulkReviewDecision}
        />

        {reviewItems.length === 0 ? (
          <EmptyState
            title={hasActiveReviewFilters ? 'No results' : 'Review queue empty'}
            description={
              hasActiveReviewFilters
                ? 'Try different filters or clear the search.'
                : 'When the pipeline detects ambiguities or conflicts, they will appear here.'
            }
          />
        ) : (
          <div className="space-y-3">
            {reviewItems.map((item) => (
              <LexReviewQueueItemCard
                key={item.id}
                item={item}
                selected={selectedReview?.id === item.id}
                selectedReviewIdsForBulk={selectedReviewIdsForBulk}
                permissions={permissions}
                bulkReviewBusy={bulkReviewBusy}
                selectReview={selectReview}
                toggleBulkReviewSelection={toggleBulkReviewSelection}
                requestLexConfirm={requestLexConfirm}
                handleReviewDecision={handleReviewDecision}
                handleAdvancedReviewDecision={handleAdvancedReviewDecision}
              />
            ))}
          </div>
        )}
        <LexLoadMoreButton lm={lexLoadMore.review} />
      </Card>

      <Card padding="md" variant="bordered" className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Review Detail</h3>
        <LexReviewDetailPanel
          selectedReview={selectedReview}
          setTab={setTab}
          selectPublication={selectPublication}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 5 – Glossary                                                   */
/* ------------------------------------------------------------------ */
function renderGlossary(props: TabContentProps) {
  const {
    glossary,
    settings,
    loadAll,
    handlePromoteToGovernance,
    permissions,
    refreshGlossary,
    createGlossaryEntry,
    updateGlossaryEntry,
    deleteGlossaryEntry,
    requestLexConfirm,
    lexLoadMore,
    glossaryListFilters,
    onGlossaryFiltersInputChange,
    onGlossaryFiltersSearch,
    onClearGlossaryListFilters,
  } = props;

  const hasActiveGlossaryFilters = glossaryListFilters.q.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-subtle/40 p-3">
        <SearchInput
          label="Search glossary"
          placeholder="Source or target text…"
          value={glossaryListFilters.q}
          onChange={onGlossaryFiltersInputChange}
          onSearch={onGlossaryFiltersSearch}
          debounceMs={300}
          className="max-w-xl"
        />
        {hasActiveGlossaryFilters ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => onClearGlossaryListFilters()}
            >
              Clear search
            </Button>
          </div>
        ) : null}
      </div>
      <GlossaryTabPanel
        glossary={glossary}
        emptySearchActive={hasActiveGlossaryFilters}
        settings={settings}
        permissions={permissions}
        loadAll={loadAll}
        refreshGlossary={refreshGlossary}
        createGlossaryEntry={createGlossaryEntry}
        updateGlossaryEntry={updateGlossaryEntry}
        deleteGlossaryEntry={deleteGlossaryEntry}
        requestLexConfirm={requestLexConfirm}
        handlePromoteToGovernance={handlePromoteToGovernance}
        loadMore={lexLoadMore.glossary}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 6 – Rules                                                      */
/* ------------------------------------------------------------------ */
function renderRules(props: TabContentProps) {
  const {
    rules,
    settings,
    loadAll,
    handlePromoteToGovernance,
    permissions,
    refreshRules,
    createLexRule,
    updateLexRule,
    deleteLexRule,
    requestLexConfirm,
    lexLoadMore,
  } = props;

  return (
    <RulesTabPanel
      rules={rules}
      settings={settings}
      permissions={permissions}
      loadAll={loadAll}
      refreshRules={refreshRules}
      createLexRule={createLexRule}
      updateLexRule={updateLexRule}
      deleteLexRule={deleteLexRule}
      requestLexConfirm={requestLexConfirm}
      handlePromoteToGovernance={handlePromoteToGovernance}
      loadMore={lexLoadMore.rules}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 7 – Profiles                                                   */
/* ------------------------------------------------------------------ */
function renderProfiles(props: TabContentProps) {
  const {
    profiles,
    loadAll,
    handlePromoteToGovernance,
    permissions,
    refreshProfiles,
    createLexProfile,
    updateLexProfile,
    deleteLexProfile,
    requestLexConfirm,
    lexLoadMore,
  } = props;

  return (
    <ProfilesTabPanel
      profiles={profiles}
      permissions={permissions}
      loadAll={loadAll}
      refreshProfiles={refreshProfiles}
      createLexProfile={createLexProfile}
      updateLexProfile={updateLexProfile}
      deleteLexProfile={deleteLexProfile}
      requestLexConfirm={requestLexConfirm}
      handlePromoteToGovernance={handlePromoteToGovernance}
      loadMore={lexLoadMore.profiles}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 8 – Stopwords                                                  */
/* ------------------------------------------------------------------ */
function renderStopwords(props: TabContentProps) {
  const {
    stopwords,
    settings,
    loadAll,
    handlePromoteToGovernance,
    permissions,
    refreshStopwords,
    createLexStopword,
    updateLexStopword,
    deleteLexStopword,
    requestLexConfirm,
    lexLoadMore,
  } = props;

  return (
    <StopwordsTabPanel
      stopwords={stopwords}
      settings={settings}
      permissions={permissions}
      loadAll={loadAll}
      refreshStopwords={refreshStopwords}
      createLexStopword={createLexStopword}
      updateLexStopword={updateLexStopword}
      deleteLexStopword={deleteLexStopword}
      requestLexConfirm={requestLexConfirm}
      handlePromoteToGovernance={handlePromoteToGovernance}
      loadMore={lexLoadMore.stopwords}
    />
  );
}

function LexGovernanceRequestActions(
  props: Readonly<{
    item: LexGovernanceRequestDto;
    govDisabled: boolean;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleGovernanceTransition: TabContentProps['handleGovernanceTransition'];
  }>
) {
  const { item, govDisabled, requestLexConfirm, handleGovernanceTransition } = props;
  const govTitle = govDisabled ? 'Governance disabled for this shop/role.' : undefined;
  if (item.status === 'draft') {
    return (
      <Button
        size="sm"
        disabled={govDisabled}
        title={govTitle}
        onClick={() =>
          void requestLexConfirm(
            {
              title: 'Submit governance request?',
              description: `Send “${item.title ?? item.id}” for maker-checker approval.`,
              confirmLabel: 'Submit',
            },
            () => handleGovernanceTransition(item.id, 'submit')
          )
        }
      >
        Submit
      </Button>
    );
  }
  if (item.status === 'pending_approval') {
    return (
      <>
        <Button
          size="sm"
          disabled={govDisabled}
          title={govTitle}
          onClick={() =>
            void requestLexConfirm(
              {
                title: 'Approve governance request?',
                description: item.title ?? item.id,
                confirmLabel: 'Approve',
              },
              () => handleGovernanceTransition(item.id, 'approve')
            )
          }
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={govDisabled}
          title={govTitle}
          onClick={() =>
            void requestLexConfirm(
              {
                title: 'Reject governance request?',
                description:
                  'The request will be marked rejected and will not apply to global canon.',
                confirmLabel: 'Reject',
                confirmVariant: 'destructive',
              },
              () => handleGovernanceTransition(item.id, 'reject')
            )
          }
        >
          Reject
        </Button>
      </>
    );
  }
  if (item.status === 'approved') {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={govDisabled}
        title={govTitle}
        onClick={() =>
          void requestLexConfirm(
            {
              title: 'Apply canon to global configuration?',
              description:
                'This writes the approved payload into shared/global resources. This action is difficult to undo.',
              confirmLabel: 'Apply canon',
              confirmVariant: 'destructive',
            },
            () => handleGovernanceTransition(item.id, 'apply')
          )
        }
      >
        Apply Canon
      </Button>
    );
  }
  return null;
}

function LexGovernanceRequestCard(
  props: Readonly<{
    item: LexGovernanceRequestDto;
    govDisabled: boolean;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleGovernanceTransition: TabContentProps['handleGovernanceTransition'];
  }>
) {
  const { item, govDisabled, requestLexConfirm, handleGovernanceTransition } = props;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
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
            created {formatDate(item.createdAt)} · submitted {formatDate(item.submittedAt)}
            {item.approvedAt ? ` · approved ${formatDate(item.approvedAt)}` : ''}
            {item.appliedAt ? ` · applied ${formatDate(item.appliedAt)}` : ''}
          </p>
          {item.notes ? <p className="mt-1 text-sm text-muted italic">Note: {item.notes}</p> : null}
          {item.rejectionReason ? (
            <p className="mt-1 text-sm text-destructive">
              Rejection reason: {item.rejectionReason}
            </p>
          ) : null}
          {item.targetId ? (
            <p className="mt-1 text-xs font-mono text-muted">Target: {item.targetId}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <LexGovernanceRequestActions
            item={item}
            govDisabled={govDisabled}
            requestLexConfirm={requestLexConfirm}
            handleGovernanceTransition={handleGovernanceTransition}
          />
        </div>
      </div>
      {item.proposedPayload && Object.keys(item.proposedPayload).length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <LexCollapsibleJsonTree value={item.proposedPayload} title="Proposed payload" />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 9 – Governance                                                 */
/* ------------------------------------------------------------------ */
function renderGovernance(props: TabContentProps) {
  const {
    governance,
    loadAll,
    handleGovernanceTransition,
    requestLexConfirm,
    permissions,
    lexLoadMore,
    governanceActionNotes,
    setGovernanceActionNotes,
  } = props;
  const govDisabled = !permissions.canGovernance;

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Global Canon Governance</h3>
          <p className="text-sm text-muted">
            Maker-checker lane for promoting rules and global canon.
          </p>
          {govDisabled ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Governance actions are disabled for the current role (feature flag{' '}
              <code className="rounded bg-muted px-1">lex_governance_enabled</code>).
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
          Refresh
        </Button>
      </div>

      <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
        <label htmlFor="lex-governance-action-notes" className="text-xs font-medium text-muted">
          Optional notes for governance actions{' '}
          <span className="font-normal text-muted/80">
            — max {LEX_DECISION_NOTES_MAX_LENGTH} characters
          </span>
        </label>
        <textarea
          id="lex-governance-action-notes"
          className="min-h-[72px] w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-card"
          maxLength={LEX_DECISION_NOTES_MAX_LENGTH}
          value={governanceActionNotes}
          onChange={(e) => setGovernanceActionNotes(e.target.value)}
          placeholder="Reason or approval context (optional)."
          disabled={govDisabled}
          aria-describedby="lex-governance-action-notes-counter"
        />
        <p id="lex-governance-action-notes-counter" className="text-right text-xs text-muted">
          {governanceActionNotes.length}/{LEX_DECISION_NOTES_MAX_LENGTH}
        </p>
      </div>

      {governance.length === 0 ? (
        <EmptyState
          title="No governance requests"
          description="Requests appear here when rules, glossary entries or profiles are submitted for approval, or when promoting a shop override to global canon (maker-checker flow)."
        />
      ) : (
        <div className="space-y-3">
          {governance.map((item) => (
            <LexGovernanceRequestCard
              key={item.id}
              item={item}
              govDisabled={govDisabled}
              requestLexConfirm={requestLexConfirm}
              handleGovernanceTransition={handleGovernanceTransition}
            />
          ))}
        </div>
      )}
      <LexLoadMoreButton lm={lexLoadMore.governance} />
    </Card>
  );
}

function LexPublicationsFiltersBar(
  props: Readonly<{
    publicationsListFilters: LexPublicationsListFilters;
    hasActivePublicationsFilters: boolean;
    onPublicationsFiltersInputChange: TabContentProps['onPublicationsFiltersInputChange'];
    onPublicationsFiltersSearch: TabContentProps['onPublicationsFiltersSearch'];
    onPublicationsFilterImmediate: TabContentProps['onPublicationsFilterImmediate'];
    onClearPublicationsListFilters: TabContentProps['onClearPublicationsListFilters'];
  }>
) {
  const {
    publicationsListFilters,
    hasActivePublicationsFilters,
    onPublicationsFiltersInputChange,
    onPublicationsFiltersSearch,
    onPublicationsFilterImmediate,
    onClearPublicationsListFilters,
  } = props;
  return (
    <div className="space-y-3 rounded-md border border-border bg-subtle/40 p-3">
      <SearchInput
        label="Search publications"
        placeholder="Path, record ID, target type or error message…"
        value={publicationsListFilters.q}
        onChange={onPublicationsFiltersInputChange}
        onSearch={onPublicationsFiltersSearch}
        debounceMs={300}
        className="max-w-xl"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Status</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={publicationsListFilters.status}
            onChange={(e) => onPublicationsFilterImmediate({ status: e.target.value })}
          >
            <option value="">All</option>
            {LEX_PUBLICATION_TARGET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[220px] flex-col gap-1 text-xs font-medium text-muted">
          <span>Target type</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={publicationsListFilters.targetType}
            onChange={(e) => onPublicationsFilterImmediate({ targetType: e.target.value })}
          >
            <option value="">All</option>
            {LEX_PUBLICATION_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={!hasActivePublicationsFilters}
          onClick={() => onClearPublicationsListFilters()}
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function LexPublicationProdTranslationsPreview(
  props: Readonly<{ detail: LexPublicationDetailDto }>
) {
  const preview = prodTranslationPreviewFromPublication(props.detail);
  if (!preview) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border border-border bg-card p-3 text-sm">
        <span className="text-xs font-medium text-muted">Before</span>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{preview.before}</p>
      </div>
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
        <span className="text-xs font-medium text-primary">After (aplicat)</span>
        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
          <mark className="bg-primary/25 text-inherit dark:bg-primary/35">{preview.after}</mark>
        </p>
      </div>
    </div>
  );
}

function LexPublicationInlineListPreview(
  props: Readonly<{
    rowMatchesSelection: boolean;
    selectedPublication: LexPublicationDetailDto | null;
  }>
) {
  const { rowMatchesSelection, selectedPublication } = props;
  if (!rowMatchesSelection || !selectedPublication) {
    return (
      <p className="mt-1 text-xs text-muted">Select this target for full before/after preview.</p>
    );
  }
  const preview = prodTranslationPreviewFromPublication(selectedPublication);
  if (!preview) {
    return (
      <p className="mt-1 text-xs text-muted">
        Preview detaliat disponibil doar pentru target-uri{' '}
        <code className="rounded bg-muted px-1">prod_translations</code>.
      </p>
    );
  }
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <div className="rounded-md border border-border bg-card p-2 text-xs">
        <span className="font-medium text-muted">Before</span>
        <p className="mt-1 whitespace-pre-wrap break-words">{preview.before}</p>
      </div>
      <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
        <span className="font-medium text-primary">After</span>
        <p className="mt-1 whitespace-pre-wrap break-words">
          <mark className="bg-primary/25 text-inherit dark:bg-primary/35">{preview.after}</mark>
        </p>
      </div>
    </div>
  );
}

function LexPublicationConflictDiffBlock(props: Readonly<{ detail: LexPublicationDetailDto }>) {
  const pair = prodTranslationDiffFromPublication(props.detail);
  if (!pair) {
    return (
      <p className="text-sm text-muted">
        Diff detaliat este disponibil pentru target-uri{' '}
        <code className="rounded bg-muted px-1">prod_translations</code> cu payload valid.
      </p>
    );
  }
  return (
    <LexTranslationDiff
      original={pair.current}
      translated={pair.proposed}
      leftCaption="Current (magazin)"
      rightCaption="Proposed (Lex)"
    />
  );
}

function LexPublicationTargetListRow(
  props: Readonly<{
    item: LexPublicationTargetDto;
    selectedPublicationId: string | undefined;
    selectedPublication: LexPublicationDetailDto | null;
    showPreview: boolean;
    onTogglePreview: () => void;
    pubActionsDisabled: boolean;
    selectPublication: (id: string) => Promise<void>;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleRetryPublication: TabContentProps['handleRetryPublication'];
    handleRollbackPublication: TabContentProps['handleRollbackPublication'];
    handleResolvePublicationConflict: TabContentProps['handleResolvePublicationConflict'];
  }>
) {
  const {
    item,
    selectedPublicationId,
    selectedPublication,
    showPreview,
    onTogglePreview,
    pubActionsDisabled,
    selectPublication,
    requestLexConfirm,
    handleRetryPublication,
    handleRollbackPublication,
    handleResolvePublicationConflict,
  } = props;
  const pubTitle = lexPublicationActionsDisabledTitle(pubActionsDisabled);
  const hasConflict = publicationHasPublishConflict(item);
  const rowSelected = selectedPublicationId === item.id;

  return (
    <div className={publicationListItemToneClass(rowSelected, hasConflict)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          className="w-full text-left"
          onClick={() => void selectPublication(item.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void selectPublication(item.id);
            }
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{item.targetType}</p>
            {hasConflict ? (
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                publish_conflict
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted">
            {item.targetPath ?? item.targetRecordId ?? 'no destination'} · status {item.status} ·
            attempt {item.attemptCount}
          </p>
          <p className="text-xs text-muted">{item.errorMessage ?? 'No errors recorded.'}</p>
          {hasConflict ? (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              Publish conflict: manually approved text in store vs Lex translation.
            </p>
          ) : null}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onTogglePreview}>
            {showPreview ? 'Hide Preview' : 'Preview'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pubActionsDisabled}
            title={pubTitle}
            onClick={() =>
              void requestLexConfirm(
                {
                  title: 'Retry publication?',
                  description: `${item.targetType} · ${item.targetPath ?? item.targetRecordId ?? item.id}`,
                  confirmLabel: 'Retry publish',
                },
                () => handleRetryPublication(item.id)
              )
            }
          >
            Retry Publish
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pubActionsDisabled}
            title={pubTitle}
            onClick={() =>
              void requestLexConfirm(
                {
                  title: 'Rollback this publication?',
                  description:
                    'Reverts published data using stored snapshots where possible. Confirm only if you understand the impact.',
                  confirmLabel: 'Rollback',
                  confirmVariant: 'destructive',
                },
                () => handleRollbackPublication(item.id)
              )
            }
          >
            Rollback
          </Button>
        </div>
      </div>

      {hasConflict ? (
        <div className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
          <p className="mb-2 text-sm font-medium text-yellow-900 dark:text-yellow-100">
            Conflict detected
          </p>
          <p className="mb-2 text-xs text-muted">
            Store value differs from Lex proposal. Resolve directly or open detaliul pentru diff
            complet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pubActionsDisabled}
              title={pubTitle}
              onClick={() =>
                void requestLexConfirm(
                  {
                    title: 'Accept Lex translation?',
                    description:
                      'Remove manual block, re-queue publication and apply the Lex translation.',
                    confirmLabel: 'Accept New',
                  },
                  () => handleResolvePublicationConflict(item.id, 'accept_lex')
                )
              }
            >
              Accept New
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pubActionsDisabled}
              title={pubTitle}
              onClick={() =>
                void requestLexConfirm(
                  {
                    title: 'Keep current storefront text?',
                    description:
                      'Cancel this publication target and mark the conflict as resolved in favor of the store text.',
                    confirmLabel: 'Keep Current',
                    confirmVariant: 'destructive',
                  },
                  () => handleResolvePublicationConflict(item.id, 'keep_manual')
                )
              }
            >
              Keep Current
            </Button>
          </div>
        </div>
      ) : null}

      {showPreview ? (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          <p className="mb-1 text-xs font-medium text-blue-900 dark:text-blue-100">
            Publication Preview
          </p>
          <div className="text-sm text-foreground">
            <p>
              <span className="font-medium">Target:</span> {item.targetType} ·{' '}
              {item.targetPath ?? item.targetRecordId ?? '—'}
            </p>
            <p>
              <span className="font-medium">Status:</span> {item.status} · attempt{' '}
              {item.attemptCount}
            </p>
            <LexPublicationInlineListPreview
              rowMatchesSelection={rowSelected}
              selectedPublication={selectedPublication}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LexPublicationDetailPanel(
  props: Readonly<{
    selectedPublication: LexPublicationDetailDto;
    pubActionsDisabled: boolean;
    requestLexConfirm: TabContentProps['requestLexConfirm'];
    handleResolvePublicationConflict: TabContentProps['handleResolvePublicationConflict'];
  }>
) {
  const {
    selectedPublication,
    pubActionsDisabled,
    requestLexConfirm,
    handleResolvePublicationConflict,
  } = props;
  const pubTitle = lexPublicationActionsDisabledTitle(pubActionsDisabled);
  const showConflict = publicationHasPublishConflict(
    selectedPublication,
    selectedPublication.events
  );

  return (
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
          status {selectedPublication.status} · attempts {selectedPublication.attemptCount}
        </p>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-foreground">localizationId: </span>
          <span className="font-mono text-xs">{selectedPublication.localizationId ?? '-'}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-1 font-semibold ${rollbackToneClass(selectedPublication.rollbackable, selectedPublication.snapshotCompleteness)}`}
          >
            rollback{' '}
            {selectedPublication.rollbackable
              ? 'enabled'
              : selectedPublication.snapshotCompleteness}
          </span>
          {selectedPublication.needsRepair ? (
            <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
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

      {showConflict ? (
        <div className="space-y-3 rounded-lg border border-amber-300/80 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-900 dark:text-amber-100">
            Conflict publicare (f5-02)
          </h5>
          <p className="text-sm text-muted">
            Store value (manually approved) differs from the Lex proposal. Accept applies the Lex
            translation; Keep preserves the current store text and cancels this target.
          </p>
          <LexPublicationConflictDiffBlock detail={selectedPublication} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pubActionsDisabled}
              title={pubTitle}
              onClick={() =>
                void requestLexConfirm(
                  {
                    title: 'Accept Lex translation?',
                    description:
                      'Remove manual block, re-queue publication and apply the Lex translation at the next publish run.',
                    confirmLabel: 'Accept',
                  },
                  () => handleResolvePublicationConflict(selectedPublication.id, 'accept_lex')
                )
              }
            >
              Accept (Lex)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pubActionsDisabled}
              title={pubTitle}
              onClick={() =>
                void requestLexConfirm(
                  {
                    title: 'Keep current storefront text?',
                    description:
                      'Cancel this publication target and mark the conflict as resolved in favor of the store text.',
                    confirmLabel: 'Keep',
                    confirmVariant: 'destructive',
                  },
                  () => handleResolvePublicationConflict(selectedPublication.id, 'keep_manual')
                )
              }
            >
              Keep (magazin)
            </Button>
          </div>
        </div>
      ) : null}

      {shouldShowPublicationPreview(selectedPublication) ? (
        <div className="space-y-3 rounded-lg border border-border bg-subtle/40 p-4">
          <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            Pre-publish preview (f5-03)
          </h5>
          <p className="text-sm text-muted">
            How the translated content will look compared to the current snapshot (title and
            description in <code className="mx-1 rounded bg-muted px-1">prod_translations</code>).
          </p>
          <LexPublicationProdTranslationsPreview detail={selectedPublication} />
        </div>
      ) : null}

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Snapshots</h5>
        <div className="grid gap-3 lg:grid-cols-2">
          <LexCollapsibleJsonTree
            value={selectedPublication.previousSnapshot}
            title="Previous snapshot"
          />
          <LexCollapsibleJsonTree
            value={selectedPublication.publishedSnapshot}
            title="Published snapshot"
          />
        </div>
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
          Target payload
        </h5>
        <LexCollapsibleJsonTree value={selectedPublication.payload} />
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Timeline</h5>
        {selectedPublication.events.length === 0 ? (
          <EmptyState
            title="No timeline events"
            description="No publish events recorded for this target."
          />
        ) : (
          <div className="space-y-2">
            {selectedPublication.events.map((event) => (
              <div key={event.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">
                    {event.action} · {event.status}
                  </span>
                  <span className="text-xs text-muted">{formatDate(event.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{event.errorMessage ?? 'No error.'}</p>
                <div className="mt-2 space-y-2">
                  <LexCollapsibleJsonTree
                    value={event.requestPayload}
                    title="Request"
                    className="border-0 bg-subtle/40 p-2"
                  />
                  <LexCollapsibleJsonTree
                    value={event.responsePayload}
                    title="Response"
                    className="border-0 bg-subtle/40 p-2"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 10 – Publications                                              */
/* ------------------------------------------------------------------ */
function LexPublicationsTab(props: Readonly<TabContentProps>) {
  const {
    publications,
    selectedPublication,
    selectPublication,
    loadAll,
    handleRetryPublication,
    handleRollbackPublication,
    handleResolvePublicationConflict,
    requestLexConfirm,
    permissions,
    lexLoadMore,
    publicationsListFilters,
    onPublicationsFiltersInputChange,
    onPublicationsFiltersSearch,
    onPublicationsFilterImmediate,
    onClearPublicationsListFilters,
  } = props;
  const pubActionsDisabled = !permissions.canPublish;
  const [showPreviewId, setShowPreviewId] = useState<string | null>(null);

  const hasActivePublicationsFilters =
    publicationsListFilters.q.trim() !== '' ||
    publicationsListFilters.status !== '' ||
    publicationsListFilters.targetType !== '';

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_minmax(0,1fr)]">
      <Card padding="md" variant="bordered" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Publication Targets</h3>
            <p className="text-sm text-muted">
              Publication status for `prod_translations`, `prod_attr_synonyms`, `prod_semantics` and
              collections.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh data"
            onClick={() => void loadAll()}
          >
            Refresh
          </Button>
        </div>

        <LexPublicationsFiltersBar
          publicationsListFilters={publicationsListFilters}
          hasActivePublicationsFilters={hasActivePublicationsFilters}
          onPublicationsFiltersInputChange={onPublicationsFiltersInputChange}
          onPublicationsFiltersSearch={onPublicationsFiltersSearch}
          onPublicationsFilterImmediate={onPublicationsFilterImmediate}
          onClearPublicationsListFilters={onClearPublicationsListFilters}
        />

        {publications.length === 0 ? (
          <EmptyState
            title={hasActivePublicationsFilters ? 'No results' : 'No publication targets'}
            description={
              hasActivePublicationsFilters
                ? 'Try different filters or clear the search.'
                : 'After approval and composition, publish operations and retries will appear here.'
            }
          />
        ) : (
          <div className="space-y-3">
            {publications.map((item) => (
              <LexPublicationTargetListRow
                key={item.id}
                item={item}
                selectedPublicationId={selectedPublication?.id}
                selectedPublication={selectedPublication}
                showPreview={showPreviewId === item.id}
                onTogglePreview={() =>
                  setShowPreviewId((prev) => (prev === item.id ? null : item.id))
                }
                pubActionsDisabled={pubActionsDisabled}
                selectPublication={selectPublication}
                requestLexConfirm={requestLexConfirm}
                handleRetryPublication={handleRetryPublication}
                handleRollbackPublication={handleRollbackPublication}
                handleResolvePublicationConflict={handleResolvePublicationConflict}
              />
            ))}
          </div>
        )}
        <LexLoadMoreButton lm={lexLoadMore.publications} />
      </Card>

      <Card padding="md" variant="bordered" className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Publication Detail</h3>
        {selectedPublication ? (
          <LexPublicationDetailPanel
            selectedPublication={selectedPublication}
            pubActionsDisabled={pubActionsDisabled}
            requestLexConfirm={requestLexConfirm}
            handleResolvePublicationConflict={handleResolvePublicationConflict}
          />
        ) : (
          <EmptyState
            title="Select a publication target"
            description="Snapshots, rollback eligibility and event history will appear here."
          />
        )}
      </Card>
    </div>
  );
}

function guardrailsVerdictToneClass(verdict: string): string {
  if (verdict === 'block') {
    return 'font-semibold text-red-600 dark:text-red-400';
  }
  if (verdict === 'warn') {
    return 'text-amber-600 dark:text-amber-400';
  }
  return 'text-green-600 dark:text-green-400';
}

export function collectLexShopSettingsFieldErrors(
  settings: LexShopSettingsDto | null
): string[] | null {
  if (!settings) return null;
  const errs: string[] = [];
  const check01 = (label: string, v: number) => {
    if (!Number.isFinite(v) || v < 0 || v > 1) errs.push(`${label} must be between 0 and 1.`);
  };
  check01('Consensus escalation threshold', settings.consensusEscalationThreshold);
  check01('TM similarity threshold', settings.tmSimilarityThreshold);
  check01('Translation auto-approve threshold', settings.translationAutoApproveThreshold);
  check01('Localization auto-approve threshold', settings.localizationAutoApproveThreshold);
  if (
    !Number.isFinite(settings.qualityAuditMinBatchSize) ||
    settings.qualityAuditMinBatchSize < 1
  ) {
    errs.push('Quality audit min batch size must be ≥ 1.');
  }
  if (
    !Number.isFinite(settings.maxTermsPerLlmBatch) ||
    settings.maxTermsPerLlmBatch < 1 ||
    settings.maxTermsPerLlmBatch > 500
  ) {
    errs.push('Max terms per LLM batch must be between 1 and 500.');
  }
  if (!Number.isFinite(settings.shardSize) || settings.shardSize < 1) {
    errs.push('Shard size must be ≥ 1.');
  }
  return errs.length > 0 ? errs : null;
}

export function parseExtractScopeTextError(extractScopeText: string): string | null {
  try {
    JSON.parse(extractScopeText);
    return null;
  } catch (e) {
    if (!(e instanceof SyntaxError)) return 'Invalid JSON';
    const posMatch = /position\s+(\d+)/i.exec(e.message);
    if (!posMatch) return e.message;
    const pos = Number(posMatch[1]);
    const before = extractScopeText.slice(0, pos);
    const line = (before.match(/\n/g)?.length ?? 0) + 1;
    const col = pos - before.lastIndexOf('\n');
    return `${e.message} (line ${line}, col ${col})`;
  }
}

function LexSettingsAiTranslationSection(
  props: Readonly<{
    settings: LexShopSettingsDto;
    setSettings: TabContentProps['setSettings'];
  }>
) {
  const { settings, setSettings } = props;
  return (
    <div className="space-y-3 border-t border-border pt-4 dark:border-border">
      <h4 className="text-sm font-semibold text-foreground dark:text-foreground">
        AI Translation Configuration
      </h4>
      <p className="text-xs text-muted dark:text-muted">
        Self-hosted Qwen routing, translation memory, consensus escalation, and quality audit
        batches. Values are stored in{' '}
        <code className="rounded bg-muted px-1 text-[11px] dark:bg-muted">lex_shop_settings</code> .
      </p>
      <label className="space-y-1">
        <span className="text-sm font-medium text-foreground">Translation mode</span>
        <select
          className="w-full max-w-md rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card dark:text-foreground"
          value={settings.translationMode}
          onChange={(event) =>
            setSettings((current) =>
              current
                ? {
                    ...current,
                    translationMode: event.target.value as LexShopSettingsDto['translationMode'],
                  }
                : current
            )
          }
        >
          <option value="auto">auto</option>
          <option value="single">single (one model)</option>
          <option value="consensus">consensus (multi-model)</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">
            Consensus escalation threshold (0–1)
          </span>
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.consensusEscalationThreshold}
            onChange={(event) =>
              setSettings((current) =>
                current
                  ? {
                      ...current,
                      consensusEscalationThreshold: Number(event.target.value),
                    }
                  : current
              )
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">TM similarity threshold (0–1)</span>
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.tmSimilarityThreshold}
            onChange={(event) =>
              setSettings((current) =>
                current
                  ? { ...current, tmSimilarityThreshold: Number(event.target.value) }
                  : current
              )
            }
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">
            Translation Auto-approve Threshold (0–1)
          </span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.translationAutoApproveThreshold}
            onChange={(event) =>
              setSettings((current) =>
                current
                  ? {
                      ...current,
                      translationAutoApproveThreshold: Number(event.target.value),
                    }
                  : current
              )
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">
            Localization Auto-approve Threshold (0–1)
          </span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.localizationAutoApproveThreshold}
            onChange={(event) =>
              setSettings((current) =>
                current
                  ? {
                      ...current,
                      localizationAutoApproveThreshold: Number(event.target.value),
                    }
                  : current
              )
            }
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">Quality audit min batch size</span>
          <input
            type="number"
            min={1}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.qualityAuditMinBatchSize}
            onChange={(event) =>
              setSettings((current) =>
                current
                  ? {
                      ...current,
                      qualityAuditMinBatchSize: Number(event.target.value),
                    }
                  : current
              )
            }
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-foreground">Max terms per LLM batch</span>
          <input
            type="number"
            min={1}
            max={500}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card"
            value={settings.maxTermsPerLlmBatch}
            onChange={(event) =>
              setSettings((current) =>
                current ? { ...current, maxTermsPerLlmBatch: Number(event.target.value) } : current
              )
            }
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Checkbox
          checked={settings.tmEnabled}
          label="Translation memory (semantic) enabled"
          description="Use embedding similarity against approved translations before LLM."
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, tmEnabled: event.target.checked } : current
            )
          }
        />
        <Checkbox
          checked={settings.qualityAuditEnabled}
          label="Quality audit batches enabled"
          description="Periodic QwQ audit on large batches of new translations."
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, qualityAuditEnabled: event.target.checked } : current
            )
          }
        />
      </div>
    </div>
  );
}

function LexSettingsGuardrailsSection(
  props: Readonly<{
    settings: LexShopSettingsDto;
    setSettings: TabContentProps['setSettings'];
    settingsRw: boolean;
    guardrailsStats: LexGuardrailsStatsDto | null;
    guardrailsEvents: readonly LexGuardrailsEventDto[];
    handleGuardrailsModeChange: TabContentProps['handleGuardrailsModeChange'];
  }>
) {
  const {
    settings,
    setSettings,
    settingsRw,
    guardrailsStats,
    guardrailsEvents,
    handleGuardrailsModeChange,
  } = props;
  return (
    <div className="space-y-3 border-t border-border pt-4 dark:border-border">
      <h4 className="text-sm font-semibold text-foreground dark:text-foreground">Guardrails</h4>
      <p className="text-xs text-muted dark:text-muted">
        Controlul modului de enforcement al guardrails-urilor lexicale. Modul <strong>warn</strong>{' '}
        only logs, <strong>enforce</strong> blocks translations problematice, iar{' '}
        <strong>progressive</strong> trece automat de la warn la enforce when the warning threshold
        is reached.
      </p>

      <label className="space-y-1">
        <span className="text-sm font-medium text-foreground">Guardrails mode</span>
        <select
          className="w-full max-w-md rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground dark:border-border dark:bg-card dark:text-foreground"
          value={settings.guardrailsLexMode}
          onChange={(event) => {
            const mode = event.target.value as LexGuardrailsMode;
            setSettings((current) => (current ? { ...current, guardrailsLexMode: mode } : current));
            void handleGuardrailsModeChange(mode);
          }}
        >
          <option value="warn">warn (log only)</option>
          <option value="enforce">enforce (block bad translations)</option>
          <option value="progressive">progressive (auto-escalate)</option>
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {settings.guardrailsWarnCount}
          </p>
          <p className="text-xs text-muted">Warnings</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {settings.guardrailsBlockCount}
          </p>
          <p className="text-xs text-muted">Blocks</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {settings.guardrailsFalsePositiveCount}
          </p>
          <p className="text-xs text-muted">False positives</p>
        </div>
      </div>

      {guardrailsStats ? (
        <div className="space-y-1 text-xs text-muted">
          <p>
            Total events: <strong>{guardrailsStats.totalEvents}</strong> | Pass:{' '}
            {guardrailsStats.passCount} | Warn: {guardrailsStats.warnCount} | Block:{' '}
            {guardrailsStats.blockCount}
          </p>
          {guardrailsStats.topReasons.length > 0 ? (
            <div>
              <span className="font-medium">Top reasons:</span>{' '}
              {guardrailsStats.topReasons
                .slice(0, 5)
                .map((r) => `${r.reason} (${r.count})`)
                .join(', ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {guardrailsEvents.length > 0 ? (
        <div className="space-y-1">
          <h5 className="text-xs font-semibold text-foreground">Recent guardrail events</h5>
          <div className="max-h-60 overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Recent guardrail events</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-2 py-1">Verdict</th>
                  <th className="px-2 py-1">Scanner</th>
                  <th className="px-2 py-1">Phase</th>
                  <th className="px-2 py-1">Reasons</th>
                  <th className="px-2 py-1">Date</th>
                </tr>
              </thead>
              <tbody>
                {guardrailsEvents.map((evt) => (
                  <tr key={evt.id} className="border-b border-border/50">
                    <td className="px-2 py-1">
                      <span className={guardrailsVerdictToneClass(evt.verdict)}>{evt.verdict}</span>
                    </td>
                    <td className="px-2 py-1 font-mono">{evt.scanPoint}</td>
                    <td className="px-2 py-1">{evt.pipelinePhase}</td>
                    <td className="max-w-[200px] truncate px-2 py-1">{evt.reasons.join(', ')}</td>
                    <td className="whitespace-nowrap px-2 py-1">{formatDate(evt.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {settings.guardrailsLexMode === 'warn' || settings.guardrailsLexMode === 'progressive' ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={!settingsRw}
          onClick={() => {
            setSettings((current) =>
              current ? { ...current, guardrailsLexMode: 'enforce' as LexGuardrailsMode } : current
            );
            void handleGuardrailsModeChange('enforce');
          }}
        >
          Switch to enforce mode
        </Button>
      ) : null}
    </div>
  );
}

function LexSettingsAutopublishSidebar(
  props: Readonly<{
    settings: LexShopSettingsDto;
    setSettings: TabContentProps['setSettings'];
    settingsFieldErrors: string[] | null;
    extractScopeError: string | null;
    settingsDirty: boolean;
    savingSettings: boolean;
    settingsRw: boolean;
    handleSaveSettings: TabContentProps['handleSaveSettings'];
  }>
) {
  const {
    settings,
    setSettings,
    settingsFieldErrors,
    extractScopeError,
    settingsDirty,
    savingSettings,
    settingsRw,
    handleSaveSettings,
  } = props;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-subtle/40 p-4">
      <Checkbox
        checked={settings.enabled}
        label="Enable lexical module"
        description="Enable runs, UI and APIs for Module N."
        onChange={(event) =>
          setSettings((current) =>
            current ? { ...current, enabled: event.target.checked } : current
          )
        }
      />
      <Checkbox
        checked={settings.autoPublishProducts}
        label="Auto publish products"
        description="Allow publishing into `prod_translations` from approved localizations."
        onChange={(event) =>
          setSettings((current) =>
            current ? { ...current, autoPublishProducts: event.target.checked } : current
          )
        }
      />
      <Checkbox
        checked={settings.autoPublishAttributes}
        label="Auto publish attributes"
        description="Allow publishing resolved synonyms to `prod_attr_synonyms`."
        onChange={(event) =>
          setSettings((current) =>
            current ? { ...current, autoPublishAttributes: event.target.checked } : current
          )
        }
      />
      <Checkbox
        checked={settings.autoPublishCollections}
        label="Auto publish collections"
        description="Allow write-through into `shopify_collections.title_en/description_en`."
        onChange={(event) =>
          setSettings((current) =>
            current ? { ...current, autoPublishCollections: event.target.checked } : current
          )
        }
      />
      {settingsFieldErrors ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {settingsFieldErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button
        disabled={
          savingSettings ||
          !settingsRw ||
          !settingsDirty ||
          Boolean(extractScopeError) ||
          Boolean(settingsFieldErrors)
        }
        aria-busy={savingSettings}
        aria-label="Save settings"
        onClick={() => void handleSaveSettings()}
      >
        {savingSettings ? 'Saving...' : 'Save Settings'}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 11 – Settings                                                  */
/* ------------------------------------------------------------------ */
function renderSettings(props: TabContentProps) {
  const {
    settings,
    setSettings,
    extractScopeText,
    setExtractScopeText,
    settingsDirty,
    savingSettings,
    handleSaveSettings,
    permissions,
    guardrailsStats,
    guardrailsEvents,
    handleGuardrailsModeChange,
  } = props;
  const settingsRw = permissions.canManageSettings;

  const settingsFieldErrors = collectLexShopSettingsFieldErrors(settings);
  const extractScopeError = parseExtractScopeTextError(extractScopeText);

  return (
    <Card padding="md" variant="bordered" className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Lex Module Settings</h3>
        <p className="text-sm text-muted">
          Operational control for scope, retention and autopublish. Configuration is strictly
          per-shop.
        </p>
        {settingsRw ? null : (
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
            Read-only view: settings write is disabled (feature flag{' '}
            <code className="rounded bg-muted px-1">lex_settings_write_enabled</code>).
          </p>
        )}
      </div>

      {settingsDirty && settingsRw ? (
        <output className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100">
          Ai modificări nesalvate. Apasă „Save Settings" pentru a le aplica.
        </output>
      ) : null}

      {/* FIX S7735: flipped negated condition */}
      {settings ? (
        <fieldset
          disabled={!settingsRw}
          aria-label="Lexical module settings"
          className="m-0 min-w-0 border-0 p-0 disabled:opacity-80"
        >
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
                <label className="space-y-1">
                  <span className="text-sm font-medium text-foreground">
                    Retention fragments (days)
                  </span>
                  <input
                    type="number"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                    value={settings.retentionDaysFragments}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              retentionDaysFragments: Number(event.target.value),
                            }
                          : current
                      )
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-foreground">
                    Retention occurrences (days)
                  </span>
                  <input
                    type="number"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                    value={settings.retentionDaysOccurrences}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              retentionDaysOccurrences: Number(event.target.value),
                            }
                          : current
                      )
                    }
                  />
                </label>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Thresholds</span>
                <p className="text-xs text-muted">
                  Operational thresholds (generic object from shop settings).
                </p>
                <LexCollapsibleJsonTree value={settings.thresholds} title="thresholds" />
              </div>

              <label className="space-y-1">
                <span className="text-sm font-medium text-foreground">Extract scope JSON</span>
                <textarea
                  rows={6}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground"
                  value={extractScopeText}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setExtractScopeText(raw);
                    try {
                      const parsed = JSON.parse(raw) as Record<string, unknown>;
                      setSettings((current) =>
                        current ? { ...current, extractScope: parsed } : current
                      );
                    } catch {
                      // Păstrăm ultimul `extractScope` valid în state; mesajul e `extractScopeError`.
                    }
                  }}
                />
                {extractScopeError ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{extractScopeError}</p>
                ) : null}
              </label>

              <LexSettingsAiTranslationSection settings={settings} setSettings={setSettings} />

              <LexSettingsGuardrailsSection
                settings={settings}
                setSettings={setSettings}
                settingsRw={settingsRw}
                guardrailsStats={guardrailsStats}
                guardrailsEvents={guardrailsEvents}
                handleGuardrailsModeChange={handleGuardrailsModeChange}
              />
            </div>

            <LexSettingsAutopublishSidebar
              settings={settings}
              setSettings={setSettings}
              settingsFieldErrors={settingsFieldErrors}
              extractScopeError={extractScopeError}
              settingsDirty={settingsDirty}
              savingSettings={savingSettings}
              settingsRw={settingsRw}
              handleSaveSettings={handleSaveSettings}
            />
          </div>
        </fieldset>
      ) : (
        <EmptyState
          title="Settings not available"
          description="Reload the page or check if the lexical API is running."
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                         */
/* ------------------------------------------------------------------ */

const TAB_RENDERERS: Record<string, (p: TabContentProps) => ReactNode> = {
  overview: (p) => <LexOverviewTab {...p} />,
  runs: (p) => renderRuns(p),
  terms: (p) => renderTerms(p),
  review: (p) => renderReview(p),
  glossary: (p) => renderGlossary(p),
  rules: (p) => renderRules(p),
  profiles: (p) => renderProfiles(p),
  stopwords: (p) => renderStopwords(p),
  governance: (p) => renderGovernance(p),
  publications: (p) => <LexPublicationsTab {...p} />,
  settings: (p) => renderSettings(p),
};

function TabSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading tab content">
      <div className="h-4 rounded bg-gray-200 w-3/4 dark:bg-gray-700" />
      <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

export function TabContent(props: Readonly<TabContentProps>) {
  if (props.tabLoading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <TabSkeleton />
      </div>
    );
  }
  const renderer = TAB_RENDERERS[props.activeTab];
  return renderer ? (
    <div role="tabpanel" aria-live="polite" aria-busy="false">
      {renderer(props)}
    </div>
  ) : null;
}
