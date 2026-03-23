import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  LexBootstrapDto,
  LexCursorPage,
  LexDomainProfileDto,
  LexGovernanceRequestDto,
  LexGlossaryEntryDto,
  LexGuardrailsEventDto,
  LexGuardrailsMode,
  LexGuardrailsStatsDto,
  LexLocalizationDetail,
  LexMetricsDto,
  LexPhaseName,
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

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Tabs } from '../components/ui/tabs';
import { EmptyState } from '../components/patterns/empty-state';
import { ErrorState } from '../components/patterns/error-state';
import { LoadingState } from '../components/patterns/loading-state';
import { useApiClient } from '../hooks/use-api';
import { useLexConfirmModal } from '../hooks/use-lex-confirm-modal';
import type { LexGlossaryCreatePayload, LexGlossaryUpdatePayload } from './glossary-tab-panel';
import type { LexRuleCreatePayload, LexRuleUpdatePayload } from './rules-tab-panel';
import type { LexProfileCreatePayload, LexProfileUpdatePayload } from './profiles-tab-panel';
import type { LexStopwordCreatePayload, LexStopwordUpdatePayload } from './stopwords-tab-panel';
import {
  LEX_DECISION_NOTES_MAX_LENGTH,
  lexReviewQueueActionsOpen,
  TabContent,
  type LexCsvExportEntity,
  type LexGlossaryListFilters,
  type LexPublicationsListFilters,
  type LexReviewListFilters,
  type LexTermsListFilters,
  type TermsListItem,
} from './pim-translations-tabs';
import { LexRunStartControls } from './lex-run-start-controls';

/** Filtru `q` trimis la export CSV în funcție de entitatea selectată (tab-uri cu căutare). */
function csvExportFilterQueryForEntity(
  entity: LexCsvExportEntity,
  terms: LexTermsListFilters,
  glossary: LexGlossaryListFilters,
  review: LexReviewListFilters,
  publications: LexPublicationsListFilters
): string {
  switch (entity) {
    case 'terms':
      return terms.q.trim();
    case 'glossary':
      return glossary.q.trim();
    case 'review':
      return review.q.trim();
    case 'publications':
      return publications.q.trim();
    case 'translations':
    case 'rules':
    default:
      return '';
  }
}

function resumeLexHeartbeatAfterSuccessfulReload(
  hardPausedRef: { current: boolean },
  failuresRef: { current: number },
  setBanner: Dispatch<SetStateAction<string | null>>,
  setResumeNonce: Dispatch<SetStateAction<number>>
): void {
  const needResume = hardPausedRef.current || failuresRef.current > 0;
  if (!needResume) return;
  hardPausedRef.current = false;
  failuresRef.current = 0;
  setBanner(null);
  setResumeNonce((n) => n + 1);
}

/** Răspuns POST /pim/lex/review/bulk-decision (f4-22). */
interface LexBulkReviewApiResponse {
  succeeded: { reviewItemId: string }[];
  failed: { reviewItemId: string; code: string; message: string }[];
  totals: { requested: number; succeeded: number; failed: number };
}

const DEFAULT_TERMS_LIST_FILTERS: LexTermsListFilters = {
  q: '',
  status: '',
  domainCode: '',
  minScore: '',
  maxScore: '',
};

function buildTermsListQueryString(
  filters: LexTermsListFilters,
  limit: number,
  cursor?: string | null
): string {
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  if (cursor) p.set('cursor', cursor);
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.status) p.set('status', filters.status);
  if (filters.domainCode) p.set('domainCode', filters.domainCode);
  if (filters.minScore.trim()) p.set('minScore', filters.minScore.trim());
  if (filters.maxScore.trim()) p.set('maxScore', filters.maxScore.trim());
  return p.toString();
}

const DEFAULT_REVIEW_LIST_FILTERS: LexReviewListFilters = {
  q: '',
  status: '',
  severity: '',
  entityType: '',
};

function buildReviewListQueryString(
  filters: LexReviewListFilters,
  limit: number,
  cursor?: string | null
): string {
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  if (cursor) p.set('cursor', cursor);
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.status) p.set('status', filters.status);
  if (filters.severity) p.set('severity', filters.severity);
  if (filters.entityType) p.set('entityType', filters.entityType);
  return p.toString();
}

const DEFAULT_PUBLICATIONS_LIST_FILTERS: LexPublicationsListFilters = {
  q: '',
  status: '',
  targetType: '',
};

function buildPublicationsListQueryString(
  filters: LexPublicationsListFilters,
  limit: number,
  cursor?: string | null
): string {
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  if (cursor) p.set('cursor', cursor);
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.status) p.set('status', filters.status);
  if (filters.targetType) p.set('targetType', filters.targetType);
  return p.toString();
}

const DEFAULT_GLOSSARY_LIST_FILTERS: LexGlossaryListFilters = {
  q: '',
};

function clampLexDecisionNotes(draft: string): string {
  return draft.trim().slice(0, LEX_DECISION_NOTES_MAX_LENGTH);
}

function isFetchAborted(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (err instanceof Error && err.name === 'AbortError');
}

function buildGlossaryListQueryString(
  filters: LexGlossaryListFilters,
  limit: number,
  cursor?: string | null
): string {
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  if (cursor) p.set('cursor', cursor);
  if (filters.q.trim()) p.set('q', filters.q.trim());
  return p.toString();
}

export function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ro-RO');
  } catch {
    return value;
  }
}

/** Human-readable pause reason for lexical runs (server codes → RO UI). */
export function formatLexPauseReason(code: string | null | undefined): string {
  if (code == null || code === '') return '—';
  switch (code) {
    case 'redis_unavailable':
      return 'Redis indisponibil — pipeline oprit temporar';
    case 'budget_blocked':
      return 'Buget AI depășit';
    case 'provider_unavailable':
      return 'Furnizor AI indisponibil';
    default:
      return code;
  }
}

function getRunProgressTotal(run: LexRunSummary): number {
  return (
    (run.fragmentsCount ?? 0) +
    (run.termsCount ?? 0) +
    (run.contextsCount ?? 0) +
    (run.translationsCount ?? 0)
  );
}

function isRunActive(run: LexRunSummary): boolean {
  return run.status === 'running' || run.status === 'pending';
}

/** Polling live pentru Overview/Runs: interval de bază, backoff max, oprire după N eșecuri (f4-18). */
const LEX_HEARTBEAT_BASE_MS = 15_000;
const LEX_HEARTBEAT_MAX_MS = 120_000;
const LEX_HEARTBEAT_FAIL_THRESHOLD = 3;

/** Cache bootstrap / settings / metrics între schimbări de tab (f4-24). */
const LEX_STATIC_CACHE_MS = 30_000;

const LEX_PHASE_ORDER_UI = [
  'extract.fragments',
  'extract.entities',
  'mine.terms',
  'aggregate.stats',
  'build.contexts',
  'embed.contexts',
  'cluster.senses',
  'resolve.attributes',
  'translate.candidates',
  'compose.localizations',
  'review.enqueue',
  'publish',
] as const;

export function getLexPhaseProgress(currentPhase: LexPhaseName | null | undefined): {
  index: number;
  total: number;
} {
  const total = LEX_PHASE_ORDER_UI.length;
  if (!currentPhase) return { index: 0, total };
  const idx = (LEX_PHASE_ORDER_UI as readonly string[]).indexOf(currentPhase);
  return { index: idx < 0 ? 0 : idx + 1, total };
}

export function formatDurationSeconds(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0s';
  if (value < 60) return `${Math.max(0, Math.round(value))}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

export function severityTone(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'border-rose-300 bg-rose-50 text-rose-900';
  if (severity === 'warning') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-sky-300 bg-sky-50 text-sky-900';
}

export function runStatusClass(stale: boolean, status: string): string {
  if (stale) return 'font-medium text-amber-600';
  if (status === 'running') return 'font-medium text-primary';
  return 'text-muted';
}

export function clusterStatusLabel(isApproved: boolean, needsReview: boolean): string {
  if (isApproved) return 'approved';
  if (needsReview) return 'needs review';
  return 'draft';
}

export function rollbackToneClass(rollbackable: boolean, completeness: string | null): string {
  if (rollbackable) return 'bg-emerald-100 text-emerald-800';
  if (completeness === 'repairable') return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

export default function PimTranslationsPage() {
  const api = useApiClient();
  const { requestLexConfirm, LexConfirmModal } = useLexConfirmModal();
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
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [termFlagsSaving, setTermFlagsSaving] = useState(false);
  const [manualTranslationSaving, setManualTranslationSaving] = useState(false);
  const [editTranslationSaving, setEditTranslationSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runProgressRef = useRef<Map<string, { total: number; staleCount: number }>>(new Map());
  const [staleRunIds, setStaleRunIds] = useState<ReadonlySet<string>>(new Set());

  const [metrics, setMetrics] = useState<LexMetricsDto | null>(null);
  const [settings, setSettings] = useState<LexShopSettingsDto | null>(null);
  /** Draft JSON pentru textarea „Extract scope” — permite editare invalidă fără reset UI (f4-25). */
  const [extractScopeText, setExtractScopeText] = useState('');
  /** Ultima versiune încărcată/salvată din API — baseline pentru dirty check (f4-29). */
  const savedSettingsRef = useRef<LexShopSettingsDto | null>(null);
  const [runs, setRuns] = useState<LexRunSummary[]>([]);
  const [terms, setTerms] = useState<TermsListItem[]>([]);
  const [termsListFilters, setTermsListFilters] = useState<LexTermsListFilters>(
    DEFAULT_TERMS_LIST_FILTERS
  );
  const [reviewListFilters, setReviewListFilters] = useState<LexReviewListFilters>(
    DEFAULT_REVIEW_LIST_FILTERS
  );
  const [publicationsListFilters, setPublicationsListFilters] =
    useState<LexPublicationsListFilters>(DEFAULT_PUBLICATIONS_LIST_FILTERS);
  const [glossaryListFilters, setGlossaryListFilters] = useState<LexGlossaryListFilters>(
    DEFAULT_GLOSSARY_LIST_FILTERS
  );
  const [selectedTerm, setSelectedTerm] = useState<LexTermDetail | null>(null);
  const [localizations, setLocalizations] = useState<LexLocalizationDetail[]>([]);
  const [reviewItems, setReviewItems] = useState<LexReviewItemDetail[]>([]);
  const [selectedReview, setSelectedReview] = useState<LexReviewDetailDto | null>(null);
  const [reviewDecisionNotes, setReviewDecisionNotes] = useState('');
  const [selectedReviewIdsForBulk, setSelectedReviewIdsForBulk] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const [governanceActionNotes, setGovernanceActionNotes] = useState('');
  const [glossary, setGlossary] = useState<LexGlossaryEntryDto[]>([]);
  const [rules, setRules] = useState<LexTranslationRuleDto[]>([]);
  const [profiles, setProfiles] = useState<LexDomainProfileDto[]>([]);
  const [stopwords, setStopwords] = useState<LexStopwordDto[]>([]);
  const [governance, setGovernance] = useState<LexGovernanceRequestDto[]>([]);
  const [publications, setPublications] = useState<LexPublicationTargetDto[]>([]);
  const [selectedPublication, setSelectedPublication] = useState<LexPublicationDetailDto | null>(
    null
  );
  const [termAffectedProducts, setTermAffectedProducts] = useState<LexTermAffectedProductDto[]>([]);
  /** g3-04: agregate evenimente guardrails — populate când există endpoint dedicat în API. */
  const [guardrailsStats, setGuardrailsStats] = useState<LexGuardrailsStatsDto | null>(null);
  const [guardrailsEvents, setGuardrailsEvents] = useState<LexGuardrailsEventDto[]>([]);

  const [lexNextCursors, setLexNextCursors] = useState<{
    runs: string | null;
    terms: string | null;
    review: string | null;
    publications: string | null;
    glossary: string | null;
    rules: string | null;
    profiles: string | null;
    stopwords: string | null;
    governance: string | null;
    overviewRuns: string | null;
    overviewLocalizations: string | null;
    termProducts: string | null;
  }>({
    runs: null,
    terms: null,
    review: null,
    publications: null,
    glossary: null,
    rules: null,
    profiles: null,
    stopwords: null,
    governance: null,
    overviewRuns: null,
    overviewLocalizations: null,
    termProducts: null,
  });
  const lexNextCursorsRef = useRef(lexNextCursors);
  lexNextCursorsRef.current = lexNextCursors;
  const termsListFiltersRef = useRef(termsListFilters);
  termsListFiltersRef.current = termsListFilters;
  const reviewListFiltersRef = useRef(reviewListFilters);
  reviewListFiltersRef.current = reviewListFilters;
  const publicationsListFiltersRef = useRef(publicationsListFilters);
  publicationsListFiltersRef.current = publicationsListFilters;
  const glossaryListFiltersRef = useRef(glossaryListFilters);
  glossaryListFiltersRef.current = glossaryListFilters;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectedTermIdRef = useRef<string | null>(selectedTermId);
  selectedTermIdRef.current = selectedTermId;
  const selectedReviewIdRef = useRef<string | null>(selectedReviewId);
  selectedReviewIdRef.current = selectedReviewId;
  const selectedPublicationIdRef = useRef<string | null>(selectedPublicationId);
  selectedPublicationIdRef.current = selectedPublicationId;
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  /** Cancels in-flight PIM lexical page fetches when the tab changes or a full reload starts (f4-17). */
  const lexViewLoadAbortRef = useRef<AbortController | null>(null);
  /** Heartbeat polling: consecutive failed tab refreshes (f4-18). */
  const lexHeartbeatFailuresRef = useRef(0);
  const lexHeartbeatHardPausedRef = useRef(false);
  const lexHeartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lexHeartbeatBanner, setLexHeartbeatBanner] = useState<string | null>(null);
  const [lexHeartbeatResumeNonce, setLexHeartbeatResumeNonce] = useState(0);
  const [tabLoading, setTabLoading] = useState(false);
  const lastBootstrapFetchRef = useRef(0);

  const invalidateLexStaticCache = () => {
    lastBootstrapFetchRef.current = 0;
  };

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

  const loadTermDetail = async (termId: string | null, signal?: AbortSignal) => {
    if (!termId) {
      setSelectedTerm(null);
      setTermAffectedProducts([]);
      setLexNextCursors((p) => ({ ...p, termProducts: null }));
      return;
    }
    if (signal?.aborted) return;

    const detail = await api.getApi<{ term: LexTermDetail }>(
      `/pim/lex/terms/${termId}`,
      signal ? { signal } : {}
    );
    if (signal?.aborted) return;
    setSelectedTerm(detail.term);

    setTermAffectedProducts([]);
    setLexNextCursors((p) => ({ ...p, termProducts: null }));
    try {
      const prodResp = await api.getApi<{
        products: LexTermAffectedProductDto[];
        page: LexCursorPage<LexTermAffectedProductDto>;
      }>(`/pim/lex/terms/${termId}/products?limit=50`, signal ? { signal } : {});
      if (signal?.aborted) return;
      setTermAffectedProducts(prodResp.products);
      setLexNextCursors((p) => ({ ...p, termProducts: prodResp.page.nextCursor }));
    } catch {
      if (!signal?.aborted) {
        setTermAffectedProducts([]);
        setLexNextCursors((p) => ({ ...p, termProducts: null }));
      }
    }
  };

  const loadReviewDetail = async (reviewId: string | null, signal?: AbortSignal) => {
    if (!reviewId) {
      setSelectedReview(null);
      return;
    }
    if (signal?.aborted) return;

    const detail = await api.getApi<{ review: LexReviewDetailDto }>(
      `/pim/lex/review/${reviewId}`,
      signal ? { signal } : {}
    );
    if (signal?.aborted) return;
    setSelectedReview(detail.review);
  };

  const loadPublicationDetail = async (publicationId: string | null, signal?: AbortSignal) => {
    if (!publicationId) {
      setSelectedPublication(null);
      return;
    }
    if (signal?.aborted) return;

    const detail = await api.getApi<{ publication: LexPublicationDetailDto }>(
      `/pim/lex/publications/${publicationId}`,
      signal ? { signal } : {}
    );
    if (signal?.aborted) return;
    setSelectedPublication(detail.publication);
  };

  const runLoadMore = async (key: string, fn: () => Promise<void>) => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMoreKey(key);
    try {
      await fn();
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreKey(null);
    }
  };

  const fetchTermsFirstPage = async (filters: LexTermsListFilters, signal?: AbortSignal) => {
    const qs = buildTermsListQueryString(filters, 60);
    try {
      const termsResp = await api.getApi<{
        terms: TermsListItem[];
        page: LexCursorPage<TermsListItem>;
      }>(`/pim/lex/terms?${qs}`, signal ? { signal } : {});
      if (signal?.aborted) return;
      setTerms(termsResp.terms);
      setLexNextCursors((p) => ({ ...p, terms: termsResp.page.nextCursor }));
      setError(null);
      const sid = selectedTermIdRef.current;
      const nextTermId = sid ?? termsResp.terms[0]?.id ?? null;
      if (nextTermId) {
        if (nextTermId !== sid) setSelectionParam('termId', nextTermId);
        await loadTermDetail(nextTermId, signal);
      } else {
        setSelectedTerm(null);
        setSelectionParam('termId', null);
      }
    } catch (err) {
      if (isFetchAborted(err, signal)) return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca termenii.');
    }
  };

  const mergeTermsListFiltersAndFetch = async (patch: Partial<LexTermsListFilters>) => {
    const next = { ...termsListFiltersRef.current, ...patch };
    termsListFiltersRef.current = next;
    setTermsListFilters(next);
    await fetchTermsFirstPage(next);
  };

  const patchTermsListFilterDraft = (patch: Partial<LexTermsListFilters>) => {
    setTermsListFilters((prev) => {
      const next = { ...prev, ...patch };
      termsListFiltersRef.current = next;
      return next;
    });
  };

  const fetchReviewFirstPage = async (filters: LexReviewListFilters, signal?: AbortSignal) => {
    const qs = buildReviewListQueryString(filters, 50);
    try {
      const reviewResp = await api.getApi<{
        items: LexReviewItemDetail[];
        page: LexCursorPage<LexReviewItemDetail>;
      }>(`/pim/lex/review?${qs}`, signal ? { signal } : {});
      if (signal?.aborted) return;
      setReviewItems(reviewResp.items);
      setLexNextCursors((p) => ({ ...p, review: reviewResp.page.nextCursor }));
      setError(null);
      const rid = selectedReviewIdRef.current;
      const nextReviewId = rid ?? reviewResp.items[0]?.id ?? null;
      if (nextReviewId) {
        if (nextReviewId !== rid) setSelectionParam('reviewId', nextReviewId);
        await loadReviewDetail(nextReviewId, signal);
      } else {
        setSelectedReview(null);
        setSelectionParam('reviewId', null);
      }
    } catch (err) {
      if (isFetchAborted(err, signal)) return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca coada de review.');
    }
  };

  const mergeReviewListFiltersAndFetch = async (patch: Partial<LexReviewListFilters>) => {
    const next = { ...reviewListFiltersRef.current, ...patch };
    reviewListFiltersRef.current = next;
    setReviewListFilters(next);
    await fetchReviewFirstPage(next);
  };

  const patchReviewListFilterDraft = (patch: Partial<LexReviewListFilters>) => {
    setReviewListFilters((prev) => {
      const next = { ...prev, ...patch };
      reviewListFiltersRef.current = next;
      return next;
    });
  };

  const fetchPublicationsFirstPage = async (
    filters: LexPublicationsListFilters,
    signal?: AbortSignal
  ) => {
    const qs = buildPublicationsListQueryString(filters, 50);
    try {
      const publicationsResp = await api.getApi<{
        publications: LexPublicationTargetDto[];
        page: LexCursorPage<LexPublicationTargetDto>;
      }>(`/pim/lex/publications?${qs}`, signal ? { signal } : {});
      if (signal?.aborted) return;
      setPublications(publicationsResp.publications);
      setLexNextCursors((p) => ({ ...p, publications: publicationsResp.page.nextCursor }));
      setError(null);
      const pid = selectedPublicationIdRef.current;
      const nextPublicationId = pid ?? publicationsResp.publications[0]?.id ?? null;
      if (nextPublicationId) {
        if (nextPublicationId !== pid) setSelectionParam('publicationId', nextPublicationId);
        await loadPublicationDetail(nextPublicationId, signal);
      } else {
        setSelectedPublication(null);
        setSelectionParam('publicationId', null);
      }
    } catch (err) {
      if (isFetchAborted(err, signal)) return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca lista de publicări.');
    }
  };

  const mergePublicationsListFiltersAndFetch = async (
    patch: Partial<LexPublicationsListFilters>
  ) => {
    const next = { ...publicationsListFiltersRef.current, ...patch };
    publicationsListFiltersRef.current = next;
    setPublicationsListFilters(next);
    await fetchPublicationsFirstPage(next);
  };

  const patchPublicationsListFilterDraft = (patch: Partial<LexPublicationsListFilters>) => {
    setPublicationsListFilters((prev) => {
      const next = { ...prev, ...patch };
      publicationsListFiltersRef.current = next;
      return next;
    });
  };

  const fetchGlossaryFirstPage = async (filters: LexGlossaryListFilters, signal?: AbortSignal) => {
    const qs = buildGlossaryListQueryString(filters, 50);
    try {
      const glossaryResp = await api.getApi<{
        glossary: LexGlossaryEntryDto[];
        page: LexCursorPage<LexGlossaryEntryDto>;
      }>(`/pim/lex/glossary?${qs}`, signal ? { signal } : {});
      if (signal?.aborted) return;
      setGlossary(glossaryResp.glossary);
      setLexNextCursors((p) => ({ ...p, glossary: glossaryResp.page.nextCursor }));
      setError(null);
    } catch (err) {
      if (isFetchAborted(err, signal)) return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca glosarul.');
    }
  };

  const mergeGlossaryListFiltersAndFetch = async (patch: Partial<LexGlossaryListFilters>) => {
    const next = { ...glossaryListFiltersRef.current, ...patch };
    glossaryListFiltersRef.current = next;
    setGlossaryListFilters(next);
    await fetchGlossaryFirstPage(next);
  };

  const patchGlossaryListFilterDraft = (patch: Partial<LexGlossaryListFilters>) => {
    setGlossaryListFilters((prev) => {
      const next = { ...prev, ...patch };
      glossaryListFiltersRef.current = next;
      return next;
    });
  };

  const loadTabData = async (tabValue: string, signal?: AbortSignal) => {
    const fetchOpts: RequestInit = signal ? { signal } : {};
    const loaders: Record<string, (() => Promise<void>) | undefined> = {
      overview: async () => {
        const [runsResp, localizationsResp] = await Promise.all([
          api.getApi<{ runs: LexRunSummary[]; page: LexCursorPage<LexRunSummary> }>(
            '/pim/lex/runs?limit=6',
            fetchOpts
          ),
          api.getApi<{
            localizations: LexLocalizationDetail[];
            page: LexCursorPage<LexLocalizationDetail>;
          }>('/pim/lex/localizations?limit=5', fetchOpts),
        ]);
        if (signal?.aborted) return;
        setRuns(runsResp.runs);
        setLocalizations(localizationsResp.localizations);
        setLexNextCursors((p) => ({
          ...p,
          overviewRuns: runsResp.page.nextCursor,
          overviewLocalizations: localizationsResp.page.nextCursor,
        }));
      },
      runs: async () => {
        const runsResp = await api.getApi<{
          runs: LexRunSummary[];
          page: LexCursorPage<LexRunSummary>;
        }>('/pim/lex/runs?limit=50', fetchOpts);
        if (signal?.aborted) return;
        setRuns(runsResp.runs);
        setLexNextCursors((p) => ({ ...p, runs: runsResp.page.nextCursor }));
      },
      terms: async () => {
        await fetchTermsFirstPage(termsListFiltersRef.current, signal);
      },
      review: async () => {
        await fetchReviewFirstPage(reviewListFiltersRef.current, signal);
      },
      glossary: async () => {
        await fetchGlossaryFirstPage(glossaryListFiltersRef.current, signal);
      },
      rules: async () => {
        const rulesResp = await api.getApi<{
          rules: LexTranslationRuleDto[];
          page: LexCursorPage<LexTranslationRuleDto>;
        }>('/pim/lex/rules?limit=50', fetchOpts);
        if (signal?.aborted) return;
        setRules(rulesResp.rules);
        setLexNextCursors((p) => ({ ...p, rules: rulesResp.page.nextCursor }));
      },
      profiles: async () => {
        const profilesResp = await api.getApi<{
          profiles: LexDomainProfileDto[];
          page: LexCursorPage<LexDomainProfileDto>;
        }>('/pim/lex/profiles?limit=50', fetchOpts);
        if (signal?.aborted) return;
        setProfiles(profilesResp.profiles);
        setLexNextCursors((p) => ({ ...p, profiles: profilesResp.page.nextCursor }));
      },
      stopwords: async () => {
        const stopwordsResp = await api.getApi<{
          stopwords: LexStopwordDto[];
          page: LexCursorPage<LexStopwordDto>;
        }>('/pim/lex/stopwords?limit=50', fetchOpts);
        if (signal?.aborted) return;
        setStopwords(stopwordsResp.stopwords);
        setLexNextCursors((p) => ({ ...p, stopwords: stopwordsResp.page.nextCursor }));
      },
      governance: async () => {
        const governanceResp = await api.getApi<{
          requests: LexGovernanceRequestDto[];
          page: LexCursorPage<LexGovernanceRequestDto>;
        }>('/pim/lex/governance?limit=50', fetchOpts);
        if (signal?.aborted) return;
        setGovernance(governanceResp.requests);
        setLexNextCursors((p) => ({ ...p, governance: governanceResp.page.nextCursor }));
      },
      publications: async () => {
        await fetchPublicationsFirstPage(publicationsListFiltersRef.current, signal);
      },
    };

    await loaders[tabValue]?.();
  };

  const loadMoreOverviewRuns = () =>
    runLoadMore('overviewRuns', async () => {
      const c = lexNextCursorsRef.current.overviewRuns;
      if (!c) return;
      const resp = await api.getApi<{
        runs: LexRunSummary[];
        page: LexCursorPage<LexRunSummary>;
      }>(`/pim/lex/runs?limit=6&cursor=${encodeURIComponent(c)}`);
      setRuns((prev) => [...prev, ...resp.runs]);
      setLexNextCursors((p) => ({ ...p, overviewRuns: resp.page.nextCursor }));
    });

  const loadMoreOverviewLocalizations = () =>
    runLoadMore('overviewLocalizations', async () => {
      const c = lexNextCursorsRef.current.overviewLocalizations;
      if (!c) return;
      const resp = await api.getApi<{
        localizations: LexLocalizationDetail[];
        page: LexCursorPage<LexLocalizationDetail>;
      }>(`/pim/lex/localizations?limit=5&cursor=${encodeURIComponent(c)}`);
      setLocalizations((prev) => [...prev, ...resp.localizations]);
      setLexNextCursors((p) => ({ ...p, overviewLocalizations: resp.page.nextCursor }));
    });

  const loadMoreRuns = () =>
    runLoadMore('runs', async () => {
      const c = lexNextCursorsRef.current.runs;
      if (!c) return;
      const resp = await api.getApi<{
        runs: LexRunSummary[];
        page: LexCursorPage<LexRunSummary>;
      }>(`/pim/lex/runs?limit=50&cursor=${encodeURIComponent(c)}`);
      setRuns((prev) => [...prev, ...resp.runs]);
      setLexNextCursors((p) => ({ ...p, runs: resp.page.nextCursor }));
    });

  const loadMoreTerms = () =>
    runLoadMore('terms', async () => {
      const c = lexNextCursorsRef.current.terms;
      if (!c) return;
      const qs = buildTermsListQueryString(termsListFiltersRef.current, 60, c);
      const resp = await api.getApi<{
        terms: TermsListItem[];
        page: LexCursorPage<TermsListItem>;
      }>(`/pim/lex/terms?${qs}`);
      setTerms((prev) => [...prev, ...resp.terms]);
      setLexNextCursors((p) => ({ ...p, terms: resp.page.nextCursor }));
    });

  const loadMoreReview = () =>
    runLoadMore('review', async () => {
      const c = lexNextCursorsRef.current.review;
      if (!c) return;
      const qs = buildReviewListQueryString(reviewListFiltersRef.current, 50, c);
      const resp = await api.getApi<{
        items: LexReviewItemDetail[];
        page: LexCursorPage<LexReviewItemDetail>;
      }>(`/pim/lex/review?${qs}`);
      setReviewItems((prev) => [...prev, ...resp.items]);
      setLexNextCursors((p) => ({ ...p, review: resp.page.nextCursor }));
    });

  const loadMorePublications = () =>
    runLoadMore('publications', async () => {
      const c = lexNextCursorsRef.current.publications;
      if (!c) return;
      const qs = buildPublicationsListQueryString(publicationsListFiltersRef.current, 50, c);
      const resp = await api.getApi<{
        publications: LexPublicationTargetDto[];
        page: LexCursorPage<LexPublicationTargetDto>;
      }>(`/pim/lex/publications?${qs}`);
      setPublications((prev) => [...prev, ...resp.publications]);
      setLexNextCursors((p) => ({ ...p, publications: resp.page.nextCursor }));
    });

  const loadMoreGlossary = () =>
    runLoadMore('glossary', async () => {
      const c = lexNextCursorsRef.current.glossary;
      if (!c) return;
      const qs = buildGlossaryListQueryString(glossaryListFiltersRef.current, 50, c);
      const resp = await api.getApi<{
        glossary: LexGlossaryEntryDto[];
        page: LexCursorPage<LexGlossaryEntryDto>;
      }>(`/pim/lex/glossary?${qs}`);
      setGlossary((prev) => [...prev, ...resp.glossary]);
      setLexNextCursors((p) => ({ ...p, glossary: resp.page.nextCursor }));
    });

  const loadMoreRules = () =>
    runLoadMore('rules', async () => {
      const c = lexNextCursorsRef.current.rules;
      if (!c) return;
      const resp = await api.getApi<{
        rules: LexTranslationRuleDto[];
        page: LexCursorPage<LexTranslationRuleDto>;
      }>(`/pim/lex/rules?limit=50&cursor=${encodeURIComponent(c)}`);
      setRules((prev) => [...prev, ...resp.rules]);
      setLexNextCursors((p) => ({ ...p, rules: resp.page.nextCursor }));
    });

  const loadMoreProfiles = () =>
    runLoadMore('profiles', async () => {
      const c = lexNextCursorsRef.current.profiles;
      if (!c) return;
      const resp = await api.getApi<{
        profiles: LexDomainProfileDto[];
        page: LexCursorPage<LexDomainProfileDto>;
      }>(`/pim/lex/profiles?limit=50&cursor=${encodeURIComponent(c)}`);
      setProfiles((prev) => [...prev, ...resp.profiles]);
      setLexNextCursors((p) => ({ ...p, profiles: resp.page.nextCursor }));
    });

  const loadMoreStopwords = () =>
    runLoadMore('stopwords', async () => {
      const c = lexNextCursorsRef.current.stopwords;
      if (!c) return;
      const resp = await api.getApi<{
        stopwords: LexStopwordDto[];
        page: LexCursorPage<LexStopwordDto>;
      }>(`/pim/lex/stopwords?limit=50&cursor=${encodeURIComponent(c)}`);
      setStopwords((prev) => [...prev, ...resp.stopwords]);
      setLexNextCursors((p) => ({ ...p, stopwords: resp.page.nextCursor }));
    });

  const loadMoreGovernance = () =>
    runLoadMore('governance', async () => {
      const c = lexNextCursorsRef.current.governance;
      if (!c) return;
      const resp = await api.getApi<{
        requests: LexGovernanceRequestDto[];
        page: LexCursorPage<LexGovernanceRequestDto>;
      }>(`/pim/lex/governance?limit=50&cursor=${encodeURIComponent(c)}`);
      setGovernance((prev) => [...prev, ...resp.requests]);
      setLexNextCursors((p) => ({ ...p, governance: resp.page.nextCursor }));
    });

  const loadMoreTermProducts = () =>
    runLoadMore('termProducts', async () => {
      const termId = selectedTermIdRef.current;
      const c = lexNextCursorsRef.current.termProducts;
      if (!termId || !c) return;
      const resp = await api.getApi<{
        products: LexTermAffectedProductDto[];
        page: LexCursorPage<LexTermAffectedProductDto>;
      }>(`/pim/lex/terms/${termId}/products?limit=50&cursor=${encodeURIComponent(c)}`);
      setTermAffectedProducts((prev) => [...prev, ...resp.products]);
      setLexNextCursors((p) => ({ ...p, termProducts: resp.page.nextCursor }));
    });

  const lexLoadMore = useMemo(
    () => ({
      overviewRuns: {
        hasMore: Boolean(lexNextCursors.overviewRuns),
        loading: loadingMoreKey === 'overviewRuns',
        onLoadMore: () => void loadMoreOverviewRuns(),
      },
      overviewLocalizations: {
        hasMore: Boolean(lexNextCursors.overviewLocalizations),
        loading: loadingMoreKey === 'overviewLocalizations',
        onLoadMore: () => void loadMoreOverviewLocalizations(),
      },
      runs: {
        hasMore: Boolean(lexNextCursors.runs),
        loading: loadingMoreKey === 'runs',
        onLoadMore: () => void loadMoreRuns(),
      },
      terms: {
        hasMore: Boolean(lexNextCursors.terms),
        loading: loadingMoreKey === 'terms',
        onLoadMore: () => void loadMoreTerms(),
      },
      review: {
        hasMore: Boolean(lexNextCursors.review),
        loading: loadingMoreKey === 'review',
        onLoadMore: () => void loadMoreReview(),
      },
      publications: {
        hasMore: Boolean(lexNextCursors.publications),
        loading: loadingMoreKey === 'publications',
        onLoadMore: () => void loadMorePublications(),
      },
      glossary: {
        hasMore: Boolean(lexNextCursors.glossary),
        loading: loadingMoreKey === 'glossary',
        onLoadMore: () => void loadMoreGlossary(),
      },
      rules: {
        hasMore: Boolean(lexNextCursors.rules),
        loading: loadingMoreKey === 'rules',
        onLoadMore: () => void loadMoreRules(),
      },
      profiles: {
        hasMore: Boolean(lexNextCursors.profiles),
        loading: loadingMoreKey === 'profiles',
        onLoadMore: () => void loadMoreProfiles(),
      },
      stopwords: {
        hasMore: Boolean(lexNextCursors.stopwords),
        loading: loadingMoreKey === 'stopwords',
        onLoadMore: () => void loadMoreStopwords(),
      },
      governance: {
        hasMore: Boolean(lexNextCursors.governance),
        loading: loadingMoreKey === 'governance',
        onLoadMore: () => void loadMoreGovernance(),
      },
      termProducts: {
        hasMore: Boolean(lexNextCursors.termProducts),
        loading: loadingMoreKey === 'termProducts',
        onLoadMore: () => void loadMoreTermProducts(),
      },
    }),
    [lexNextCursors, loadingMoreKey]
  );

  const clearLexSurfaceForNoAccess = useCallback(() => {
    setSettings(null);
    setExtractScopeText('');
    savedSettingsRef.current = null;
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
    setGuardrailsStats(null);
    setGuardrailsEvents([]);
    setLexNextCursors({
      runs: null,
      terms: null,
      review: null,
      publications: null,
      glossary: null,
      rules: null,
      profiles: null,
      stopwords: null,
      governance: null,
      overviewRuns: null,
      overviewLocalizations: null,
      termProducts: null,
    });
  }, []);

  const hydrateLexStaticBundle = useCallback(
    async (signal: AbortSignal): Promise<'abort' | 'deny' | 'ok'> => {
      const bootstrapResp = await api.getApi<{ bootstrap: LexBootstrapDto }>('/pim/lex/bootstrap', {
        signal,
      });
      if (signal.aborted) return 'abort';
      setBootstrap(bootstrapResp.bootstrap);
      lastBootstrapFetchRef.current = Date.now();
      if (!bootstrapResp.bootstrap.permissions.canView) {
        clearLexSurfaceForNoAccess();
        return 'deny';
      }

      const [settingsResp, metricsResp] = await Promise.all([
        api.getApi<{ settings: LexShopSettingsDto }>('/pim/lex/settings', { signal }),
        api.getApi<{ metrics: LexMetricsDto }>('/pim/lex/metrics', { signal }),
      ]);

      if (signal.aborted) return 'abort';
      const loadedSettings = settingsResp.settings;
      savedSettingsRef.current = structuredClone(loadedSettings);
      setSettings(loadedSettings);
      setExtractScopeText(JSON.stringify(loadedSettings.extractScope ?? {}, null, 2));
      setMetrics(metricsResp.metrics);
      return 'ok';
    },
    [api, clearLexSurfaceForNoAccess]
  );

  const loadCurrentView = async () => {
    lexViewLoadAbortRef.current?.abort();
    const ac = new AbortController();
    lexViewLoadAbortRef.current = ac;
    const { signal } = ac;

    const initialBootstrap = bootstrap === null;
    if (initialBootstrap) setLoading(true);
    else setTabLoading(true);
    setError(null);
    try {
      const shouldFetchStatic =
        bootstrap === null || Date.now() - lastBootstrapFetchRef.current > LEX_STATIC_CACHE_MS;

      if (shouldFetchStatic) {
        const outcome = await hydrateLexStaticBundle(signal);
        if (outcome === 'abort' || signal.aborted) return;
        if (outcome === 'deny') return;
      } else if (!bootstrap?.permissions.canView) {
        return;
      }

      await loadTabData(activeTab, signal);
      if (signal.aborted) return;
      resumeLexHeartbeatAfterSuccessfulReload(
        lexHeartbeatHardPausedRef,
        lexHeartbeatFailuresRef,
        setLexHeartbeatBanner,
        setLexHeartbeatResumeNonce
      );
    } catch (err) {
      if (isFetchAborted(err, signal)) return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca modulul lexical.');
    } finally {
      if (lexViewLoadAbortRef.current === ac) {
        setLoading(false);
        setTabLoading(false);
      }
    }
  };

  const loadCurrentViewRef = useRef(loadCurrentView);
  loadCurrentViewRef.current = loadCurrentView;

  const loadAll = loadCurrentView;

  // Stable refs — updated every render so the interval always reads current values
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const loadTabDataRef = useRef(loadTabData);
  loadTabDataRef.current = loadTabData;

  // A run is stale when paused by the system, or when 3+ heartbeat ticks pass with no metric progress
  const isRunStale = (run: LexRunSummary): boolean =>
    run.status === 'paused' || staleRunIds.has(run.id);

  const dismissLexHeartbeatBanner = () => {
    lexHeartbeatHardPausedRef.current = false;
    lexHeartbeatFailuresRef.current = 0;
    setLexHeartbeatBanner(null);
    setLexHeartbeatResumeNonce((n) => n + 1);
  };

  // Heartbeat: backoff exponențial la erori; după 3 eșecuri — banner + pauză până la dismiss sau reload reușit (f4-18).
  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (lexHeartbeatTimerRef.current != null) {
        clearTimeout(lexHeartbeatTimerRef.current);
        lexHeartbeatTimerRef.current = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      clearTimer();
      if (cancelled || lexHeartbeatHardPausedRef.current) return;
      lexHeartbeatTimerRef.current = setTimeout(() => {
        void runTick();
      }, delayMs);
    };

    const runTick = async () => {
      if (cancelled || lexHeartbeatHardPausedRef.current) return;

      const tab = activeTabRef.current;
      if (tab !== 'overview' && tab !== 'runs') {
        scheduleNext(LEX_HEARTBEAT_BASE_MS);
        return;
      }
      if (!runsRef.current.some(isRunActive)) {
        scheduleNext(LEX_HEARTBEAT_BASE_MS);
        return;
      }

      try {
        await loadTabDataRef.current(tab);
        if (cancelled) return;
        lexHeartbeatFailuresRef.current = 0;
        setLexHeartbeatBanner(null);
        scheduleNext(LEX_HEARTBEAT_BASE_MS);
      } catch {
        if (cancelled) return;
        const n = ++lexHeartbeatFailuresRef.current;
        if (n >= LEX_HEARTBEAT_FAIL_THRESHOLD) {
          setLexHeartbeatBanner(
            'Actualizarea automată a run-urilor s-a oprit după erori repetate. Reîncarcă pagina, folosește „Închide” pentru a relua polling-ul sau așteaptă un reload reușit al modulului.'
          );
          lexHeartbeatHardPausedRef.current = true;
          return;
        }
        const delay = Math.min(LEX_HEARTBEAT_BASE_MS * 2 ** n, LEX_HEARTBEAT_MAX_MS);
        scheduleNext(delay);
      }
    };

    clearTimer();
    if (!lexHeartbeatHardPausedRef.current) {
      scheduleNext(LEX_HEARTBEAT_BASE_MS);
    }

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [activeTab, lexHeartbeatResumeNonce]);

  // Progress tracking: update stale set whenever runs list changes
  useEffect(() => {
    // ~3 tick-uri la interval minim de polling (~15s); cu backoff intervalul poate fi mai mare (f4-18).
    const STALE_TICKS = 3;
    const nextStale = new Set<string>();
    for (const run of runs) {
      if (run.status !== 'running') {
        runProgressRef.current.delete(run.id);
        continue;
      }
      const total = getRunProgressTotal(run);
      const prev = runProgressRef.current.get(run.id);
      if (prev?.total === total) {
        const newCount = prev.staleCount + 1;
        runProgressRef.current.set(run.id, { total, staleCount: newCount });
        if (newCount >= STALE_TICKS) nextStale.add(run.id);
      } else {
        runProgressRef.current.set(run.id, { total, staleCount: 0 });
      }
    }
    setStaleRunIds(nextStale);
  }, [runs]);

  useEffect(() => {
    void loadCurrentView();
  }, [activeTab]);

  useEffect(() => {
    return () => {
      lexViewLoadAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (bootstrap == null) return;
    if (bootstrap.permissions.canView) return;
    void navigate('/pim', { replace: true });
  }, [bootstrap, navigate]);

  useEffect(() => {
    setReviewDecisionNotes('');
  }, [selectedReview?.id]);

  useEffect(() => {
    setSelectedReviewIdsForBulk((prev) => {
      const actionable = new Set(
        reviewItems.filter((i) => lexReviewQueueActionsOpen(i.status)).map((i) => i.id)
      );
      const next = new Set<string>();
      for (const id of prev) {
        if (actionable.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [reviewItems]);

  const toggleBulkReviewSelection = useCallback((id: string) => {
    setSelectedReviewIdsForBulk((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAllActionableReviewsVisible = useCallback(() => {
    setSelectedReviewIdsForBulk(
      new Set(reviewItems.filter((i) => lexReviewQueueActionsOpen(i.status)).map((i) => i.id))
    );
  }, [reviewItems]);

  const clearBulkReviewSelection = useCallback(() => {
    setSelectedReviewIdsForBulk(new Set());
  }, []);

  const selectTerm = async (termId: string) => {
    try {
      setSelectionParam('termId', termId);
      const signal = lexViewLoadAbortRef.current?.signal;
      await loadTermDetail(termId, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Nu am putut încărca detaliile termenului.');
    }
  };

  const updateTermFlags = async (termId: string, patch: LexTermFlagsPatchRequest) => {
    setTermFlagsSaving(true);
    setError(null);
    try {
      await api.patchApi<unknown, LexTermFlagsPatchRequest>(`/pim/lex/terms/${termId}`, patch);
      await loadTermDetail(termId);
      setTerms((prev) =>
        prev.map((t) =>
          t.id === termId
            ? {
                ...t,
                ...(typeof patch.isTechnical === 'boolean'
                  ? { isTechnical: patch.isTechnical }
                  : {}),
                ...(typeof patch.isProtected === 'boolean'
                  ? { isProtected: patch.isProtected }
                  : {}),
              }
            : t
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza flag-urile termenului.');
    } finally {
      setTermFlagsSaving(false);
    }
  };

  const createManualLexTranslation = async (payload: {
    translatedText: string;
    targetLang: string;
    clusterId?: string | null;
  }) => {
    if (!selectedTerm || !settings) return;
    setManualTranslationSaving(true);
    setError(null);
    invalidateLexStaticCache();
    try {
      await api.postApi<unknown, Record<string, unknown>>('/pim/lex/localizations', {
        termId: selectedTerm.id,
        translatedText: payload.translatedText,
        sourceLang: settings.sourceLang,
        targetLang: payload.targetLang,
        clusterId: payload.clusterId ?? null,
      });
      await loadTermDetail(selectedTerm.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut salva traducerea manuală.');
    } finally {
      setManualTranslationSaving(false);
    }
  };

  const editManualLexTranslation = async (
    translationId: string,
    translatedText: string,
    notes?: string
  ) => {
    if (!selectedTerm) return;
    setEditTranslationSaving(true);
    setError(null);
    invalidateLexStaticCache();
    try {
      await api.patchApi(`/pim/lex/localizations/${translationId}`, {
        translatedText,
        notes,
      });
      await loadTermDetail(selectedTerm.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza traducerea.');
    } finally {
      setEditTranslationSaving(false);
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

  const handleResumeRun = async (runId: string) => {
    setResumingRunId(runId);
    setError(null);
    try {
      const result = await api.postApi<
        { recovered: boolean; reason: string },
        Record<string, never>
      >(`/pim/lex/runs/${runId}/recover`, {});
      if (!result.recovered) {
        // Run may still have been unpaused (e.g. no pending shards); refresh list always.
        if (result.reason === 'no_pending_shards_found') {
          await loadTabData(activeTab);
          return;
        }
        setError(`Recovery failed: ${result.reason ?? 'unknown'}`);
        return;
      }
      await loadTabData(activeTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut recupera run-ul lexical.');
    } finally {
      setResumingRunId(null);
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
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut porni un run lexical.');
    } finally {
      setStartingRun(false);
    }
  };

  const settingsDirty = useMemo(() => {
    if (!settings) return false;
    const saved = savedSettingsRef.current;
    if (!saved) return false;
    return JSON.stringify(settings) !== JSON.stringify(saved);
  }, [settings]);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setError(null);
    try {
      await api.putApi('/pim/lex/settings', settings);
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      const is409 =
        (err instanceof Error && 'status' in err && (err as { status: number }).status === 409) ||
        (err instanceof Error && /version.*mismatch|conflict|outdated/i.test(err.message));
      if (is409) {
        setError(
          'Versiunea setărilor a fost modificată de alt utilizator. Setările au fost reîncărcate automat — verifică valorile și salvează din nou.'
        );
        invalidateLexStaticCache();
        await loadCurrentView();
      } else {
        setError(
          err instanceof Error ? err.message : 'Nu am putut salva setările modulului lexical.'
        );
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleGuardrailsModeChange = useCallback(
    async (mode: LexGuardrailsMode) => {
      const current = settingsRef.current;
      if (!current) return;
      setError(null);
      const payload: LexShopSettingsDto = { ...current, guardrailsLexMode: mode };
      try {
        await api.putApi<unknown, LexShopSettingsDto>('/pim/lex/settings', payload);
        savedSettingsRef.current = structuredClone(payload);
        setSettings(payload);
        lastBootstrapFetchRef.current = 0;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Nu am putut actualiza modul guardrails. Setările au fost reîncărcate.'
        );
        lastBootstrapFetchRef.current = 0;
        await loadCurrentViewRef.current();
      }
    },
    [api]
  );

  const handleReviewDecision = async (id: string, decisionType: 'approve' | 'reject') => {
    try {
      const reviewItem = reviewItems.find((item) => item.id === id);
      if (!reviewItem) return;

      const draftForItem = selectedReview?.id === id ? reviewDecisionNotes : '';
      const user = clampLexDecisionNotes(draftForItem);
      const fallback =
        decisionType === 'approve'
          ? 'Approved from PIM translations review.'
          : 'Rejected from PIM translations review.';
      const notes = user || fallback;

      await api.postApi(`/pim/lex/review/${id}/decision`, {
        decisionType,
        expectedVersion: reviewItem.version,
        notes,
      });
      if (selectedReview?.id === id) setReviewDecisionNotes('');
      invalidateLexStaticCache();
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

      const draftForItem = selectedReview?.id === id ? reviewDecisionNotes : '';
      const user = clampLexDecisionNotes(draftForItem);
      const fallback =
        decisionType === 'publish'
          ? 'Publish requested from PIM translations workspace.'
          : 'Translation locked from PIM translations workspace.';
      const notes = user || fallback;

      await api.postApi(`/pim/lex/review/${id}/decision`, {
        decisionType,
        expectedVersion: reviewItem.version,
        notes,
      });
      if (selectedReview?.id === id) setReviewDecisionNotes('');
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nu am putut executa acțiunea avansată de review.'
      );
    }
  };

  const handleBulkReviewDecision = async (decisionType: 'approve' | 'reject') => {
    const ids = [...selectedReviewIdsForBulk];
    if (ids.length === 0) return;
    setBulkReviewBusy(true);
    setError(null);
    try {
      const user = clampLexDecisionNotes(reviewDecisionNotes);
      const fallback =
        decisionType === 'approve'
          ? 'Bulk approved from PIM translations review.'
          : 'Bulk rejected from PIM translations review.';
      const notesText = user || fallback;
      const decisions = ids
        .map((id) => {
          const item = reviewItems.find((r) => r.id === id);
          return item
            ? {
                reviewItemId: id,
                expectedVersion: item.version,
                decisionType,
                notes: notesText,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (decisions.length === 0) {
        return;
      }

      const data = await api.postApi<LexBulkReviewApiResponse, { decisions: typeof decisions }>(
        '/pim/lex/review/bulk-decision',
        { decisions }
      );

      if (data.failed.length > 0) {
        const codes = [...new Set(data.failed.map((f) => f.code))].join(', ');
        setError(
          `Bulk: ${data.totals.succeeded} reușite, ${data.totals.failed} eșuate (coduri: ${codes}).`
        );
      }
      clearBulkReviewSelection();
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut executa acțiunea bulk de review.');
    } finally {
      setBulkReviewBusy(false);
    }
  };

  const handleRetryPublication = async (id: string) => {
    try {
      await api.postApi(`/pim/lex/publications/${id}/retry`, {});
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut reîncerca publicarea.');
    }
  };

  const handleRollbackPublication = async (id: string) => {
    try {
      await api.postApi(`/pim/lex/publications/${id}/rollback`, {});
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut face rollback pentru publicare.');
    }
  };

  const handleResolvePublicationConflict = async (
    id: string,
    resolution: 'accept_lex' | 'keep_manual'
  ) => {
    try {
      await api.postApi(`/pim/lex/publications/${id}/resolve-conflict`, { resolution });
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut rezolva conflictul de publicare.');
    }
  };

  const handleDownloadLexCsvExport = async (entity: LexCsvExportEntity) => {
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set('format', 'csv');
      p.set('entity', entity);
      const q = csvExportFilterQueryForEntity(
        entity,
        termsListFiltersRef.current,
        glossaryListFiltersRef.current,
        reviewListFiltersRef.current,
        publicationsListFiltersRef.current
      );
      if (q) p.set('q', q);
      const response = await api.request(`/pim/lex/export?${p.toString()}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      const dispo = response.headers.get('Content-Disposition');
      const match = /filename="([^"]+)"/.exec(dispo ?? '');
      anchor.download = match?.[1] ?? `lex-${entity}-export.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      if (response.headers.get('X-Export-Truncated') === 'true') {
        setError(
          'Exportul CSV a fost trunchiat la 25.000 de rânduri. Folosește căutarea (q) în tab-ul potrivit pentru un set mai mic.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut descărca exportul CSV.');
    }
  };

  const handleDownloadLexXliffExport = async (targetLang: string) => {
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set('targetLang', targetLang);
      const response = await api.request(`/pim/lex/export-xliff?${p.toString()}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      const dispo = response.headers.get('Content-Disposition');
      const match = /filename="([^"]+)"/.exec(dispo ?? '');
      anchor.download = match?.[1] ?? `lex-translations-${targetLang}.xliff`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut descărca exportul XLIFF.');
    }
  };

  const handleImportXliff = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const response = await api.request('/pim/lex/import-xliff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: text,
      });
      const json = (await response.json()) as {
        data?: { imported: number; skipped: number; errors: string[] };
      };
      const d = json.data;
      if (d) {
        const parts = [`Import XLIFF: ${d.imported} importate, ${d.skipped} omise.`];
        if (d.errors.length > 0) {
          parts.push(`Erori (${d.errors.length}): ${d.errors.slice(0, 5).join('; ')}`);
        }
        setError(parts.join(' '));
      }
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut importa fișierul XLIFF.');
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
      invalidateLexStaticCache();
      await loadCurrentView();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea request-ul de governance.');
    }
  };

  const refreshGlossary = async () => {
    invalidateLexStaticCache();
    await fetchGlossaryFirstPage(glossaryListFiltersRef.current);
  };

  const createGlossaryEntry = async (payload: LexGlossaryCreatePayload) => {
    setError(null);
    try {
      await api.postApi('/pim/lex/glossary', {
        sourceText: payload.sourceText,
        targetText: payload.targetText,
        domainCode: payload.domainCode ?? null,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        translationKind: payload.translationKind,
        priority: payload.priority,
        isLocked: payload.isLocked,
        isActive: payload.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea intrarea în glosar.');
      throw err;
    }
  };

  const updateGlossaryEntry = async (id: string, payload: LexGlossaryUpdatePayload) => {
    setError(null);
    try {
      await api.patchApi(`/pim/lex/glossary/${id}`, { ...payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza intrarea din glosar.');
      throw err;
    }
  };

  const deleteGlossaryEntry = async (id: string, expectedVersion: number) => {
    setError(null);
    try {
      await api.deleteApi(
        `/pim/lex/glossary/${id}?expectedVersion=${encodeURIComponent(String(expectedVersion))}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut șterge intrarea din glosar.');
      throw err;
    }
  };

  const refreshRules = async () => {
    invalidateLexStaticCache();
    const rulesResp = await api.getApi<{
      rules: LexTranslationRuleDto[];
      page: LexCursorPage<LexTranslationRuleDto>;
    }>('/pim/lex/rules?limit=50');
    setRules(rulesResp.rules);
    setLexNextCursors((p) => ({ ...p, rules: rulesResp.page.nextCursor }));
  };

  const createLexRule = async (payload: LexRuleCreatePayload) => {
    setError(null);
    try {
      await api.postApi('/pim/lex/rules', {
        ruleName: payload.ruleName,
        matchTerm: payload.matchTerm,
        targetTranslation: payload.targetTranslation,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        domainCode: payload.domainCode ?? null,
        priority: payload.priority,
        isActive: payload.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea regula de traducere.');
      throw err;
    }
  };

  const updateLexRule = async (id: string, payload: LexRuleUpdatePayload) => {
    setError(null);
    try {
      await api.patchApi(`/pim/lex/rules/${id}`, {
        expectedVersion: payload.expectedVersion,
        ruleName: payload.ruleName,
        matchTerm: payload.matchTerm,
        targetTranslation: payload.targetTranslation,
        domainCode: payload.domainCode ?? null,
        priority: payload.priority,
        isActive: payload.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza regula de traducere.');
      throw err;
    }
  };

  const deleteLexRule = async (id: string, expectedVersion: number) => {
    setError(null);
    try {
      await api.deleteApi(
        `/pim/lex/rules/${id}?expectedVersion=${encodeURIComponent(String(expectedVersion))}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut șterge regula de traducere.');
      throw err;
    }
  };

  const refreshProfiles = async () => {
    invalidateLexStaticCache();
    const profilesResp = await api.getApi<{
      profiles: LexDomainProfileDto[];
      page: LexCursorPage<LexDomainProfileDto>;
    }>('/pim/lex/profiles?limit=50');
    setProfiles(profilesResp.profiles);
    setLexNextCursors((p) => ({ ...p, profiles: profilesResp.page.nextCursor }));
  };

  const createLexProfile = async (payload: LexProfileCreatePayload) => {
    setError(null);
    try {
      await api.postApi('/pim/lex/profiles', {
        domainCode: payload.domainCode,
        nameRo: payload.nameRo,
        nameEn: payload.nameEn,
        description: payload.description,
        isActive: payload.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea profilul de domeniu.');
      throw err;
    }
  };

  const updateLexProfile = async (id: string, payload: LexProfileUpdatePayload) => {
    setError(null);
    try {
      await api.patchApi(`/pim/lex/profiles/${id}`, { ...payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza profilul de domeniu.');
      throw err;
    }
  };

  const deleteLexProfile = async (id: string, expectedVersion: number) => {
    setError(null);
    try {
      await api.deleteApi(
        `/pim/lex/profiles/${id}?expectedVersion=${encodeURIComponent(String(expectedVersion))}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut șterge profilul de domeniu.');
      throw err;
    }
  };

  const refreshStopwords = async () => {
    invalidateLexStaticCache();
    const swResp = await api.getApi<{
      stopwords: LexStopwordDto[];
      page: LexCursorPage<LexStopwordDto>;
    }>('/pim/lex/stopwords?limit=50');
    setStopwords(swResp.stopwords);
    setLexNextCursors((p) => ({ ...p, stopwords: swResp.page.nextCursor }));
  };

  const createLexStopword = async (payload: LexStopwordCreatePayload) => {
    setError(null);
    try {
      await api.postApi('/pim/lex/stopwords', {
        locale: payload.locale,
        word: payload.word,
        wordType: payload.wordType,
        priority: payload.priority,
        isActive: payload.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut crea stopword-ul.');
      throw err;
    }
  };

  const updateLexStopword = async (id: string, payload: LexStopwordUpdatePayload) => {
    setError(null);
    try {
      await api.patchApi(`/pim/lex/stopwords/${id}`, { ...payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut actualiza stopword-ul.');
      throw err;
    }
  };

  const deleteLexStopword = async (id: string, expectedVersion: number) => {
    setError(null);
    try {
      await api.deleteApi(
        `/pim/lex/stopwords/${id}?expectedVersion=${encodeURIComponent(String(expectedVersion))}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nu am putut șterge stopword-ul.');
      throw err;
    }
  };

  const handleGovernanceTransition = async (
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'apply'
  ) => {
    try {
      const request = governance.find((item) => item.id === id);
      if (!request) return;

      const trimmed = clampLexDecisionNotes(governanceActionNotes);
      await api.postApi(`/pim/lex/governance/${id}/${action}`, {
        expectedVersion: request.version,
        ...(trimmed ? { notes: trimmed } : {}),
      });
      setGovernanceActionNotes('');
      invalidateLexStaticCache();
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

  if (!bootstrap) {
    return (
      <ErrorState
        message={error ?? 'Nu s-au putut încărca bootstrap-ul modulului lexical.'}
        onRetry={() => void loadCurrentView()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorState message={error} onRetry={() => void loadCurrentView()} /> : null}

      {lexHeartbeatBanner ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="min-w-0 flex-1">{lexHeartbeatBanner}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 self-start sm:self-auto"
            onClick={() => dismissLexHeartbeatBanner()}
          >
            Închide
          </Button>
        </div>
      ) : null}

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
          <LexRunStartControls
            canManageSettings={bootstrap.permissions.canManageSettings}
            startingRun={startingRun}
            onStart={handleStartRun}
          />
        </div>
      </Card>

      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={setTab}
        ariaLabel="Translation Intelligence sections"
      />

      <TabContent
        activeTab={activeTab}
        tabLoading={tabLoading}
        permissions={bootstrap.permissions}
        metrics={metrics}
        runs={runs}
        terms={terms}
        localizations={localizations}
        reviewItems={reviewItems}
        glossary={glossary}
        rules={rules}
        profiles={profiles}
        stopwords={stopwords}
        governance={governance}
        publications={publications}
        selectedTerm={selectedTerm}
        termAffectedProducts={termAffectedProducts}
        selectedReview={selectedReview}
        selectedPublication={selectedPublication}
        settings={settings}
        settingsDirty={settingsDirty}
        savingSettings={savingSettings}
        startingRun={startingRun}
        resumingRunId={resumingRunId}
        termFlagsSaving={termFlagsSaving}
        manualTranslationSaving={manualTranslationSaving}
        editTranslationSaving={editTranslationSaving}
        createManualLexTranslation={createManualLexTranslation}
        editManualLexTranslation={editManualLexTranslation}
        isRunStale={isRunStale}
        loadAll={loadAll}
        loadCurrentView={loadCurrentView}
        handleStartRun={handleStartRun}
        handleResumeRun={handleResumeRun}
        handleSaveSettings={handleSaveSettings}
        selectTerm={selectTerm}
        updateTermFlags={updateTermFlags}
        selectReview={selectReview}
        selectPublication={selectPublication}
        handleReviewDecision={handleReviewDecision}
        handleAdvancedReviewDecision={handleAdvancedReviewDecision}
        selectedReviewIdsForBulk={selectedReviewIdsForBulk}
        toggleBulkReviewSelection={toggleBulkReviewSelection}
        selectAllActionableReviewsVisible={selectAllActionableReviewsVisible}
        clearBulkReviewSelection={clearBulkReviewSelection}
        bulkReviewBusy={bulkReviewBusy}
        handleBulkReviewDecision={handleBulkReviewDecision}
        handlePromoteToGovernance={handlePromoteToGovernance}
        handleGovernanceTransition={handleGovernanceTransition}
        handleRetryPublication={handleRetryPublication}
        handleRollbackPublication={handleRollbackPublication}
        handleResolvePublicationConflict={handleResolvePublicationConflict}
        handleDownloadLexCsvExport={handleDownloadLexCsvExport}
        handleDownloadLexXliffExport={handleDownloadLexXliffExport}
        handleImportXliff={handleImportXliff}
        setTab={setTab}
        setSettings={setSettings}
        extractScopeText={extractScopeText}
        setExtractScopeText={setExtractScopeText}
        refreshGlossary={refreshGlossary}
        createGlossaryEntry={createGlossaryEntry}
        updateGlossaryEntry={updateGlossaryEntry}
        deleteGlossaryEntry={deleteGlossaryEntry}
        refreshRules={refreshRules}
        createLexRule={createLexRule}
        updateLexRule={updateLexRule}
        deleteLexRule={deleteLexRule}
        refreshProfiles={refreshProfiles}
        createLexProfile={createLexProfile}
        updateLexProfile={updateLexProfile}
        deleteLexProfile={deleteLexProfile}
        refreshStopwords={refreshStopwords}
        createLexStopword={createLexStopword}
        updateLexStopword={updateLexStopword}
        deleteLexStopword={deleteLexStopword}
        termsListFilters={termsListFilters}
        onTermsFiltersInputChange={(q) => patchTermsListFilterDraft({ q })}
        onTermsFiltersSearch={(q) => {
          void mergeTermsListFiltersAndFetch({ q });
        }}
        onTermsFilterImmediate={(patch) => {
          void mergeTermsListFiltersAndFetch(patch);
        }}
        onTermsFilterDraft={(patch) => patchTermsListFilterDraft(patch)}
        onTermsFiltersReload={() => {
          void fetchTermsFirstPage(termsListFiltersRef.current);
        }}
        onClearTermsListFilters={() => {
          void mergeTermsListFiltersAndFetch({
            q: '',
            status: '',
            domainCode: '',
            minScore: '',
            maxScore: '',
          });
        }}
        reviewListFilters={reviewListFilters}
        onReviewFiltersInputChange={(q) => patchReviewListFilterDraft({ q })}
        onReviewFiltersSearch={(q) => {
          void mergeReviewListFiltersAndFetch({ q });
        }}
        onReviewFilterImmediate={(patch) => {
          void mergeReviewListFiltersAndFetch(patch);
        }}
        onClearReviewListFilters={() => {
          void mergeReviewListFiltersAndFetch({
            q: '',
            status: '',
            severity: '',
            entityType: '',
          });
        }}
        publicationsListFilters={publicationsListFilters}
        onPublicationsFiltersInputChange={(q) => patchPublicationsListFilterDraft({ q })}
        onPublicationsFiltersSearch={(q) => {
          void mergePublicationsListFiltersAndFetch({ q });
        }}
        onPublicationsFilterImmediate={(patch) => {
          void mergePublicationsListFiltersAndFetch(patch);
        }}
        onClearPublicationsListFilters={() => {
          void mergePublicationsListFiltersAndFetch({
            q: '',
            status: '',
            targetType: '',
          });
        }}
        glossaryListFilters={glossaryListFilters}
        onGlossaryFiltersInputChange={(q) => patchGlossaryListFilterDraft({ q })}
        onGlossaryFiltersSearch={(q) => {
          void mergeGlossaryListFiltersAndFetch({ q });
        }}
        onClearGlossaryListFilters={() => {
          void mergeGlossaryListFiltersAndFetch({ q: '' });
        }}
        requestLexConfirm={requestLexConfirm}
        lexLoadMore={lexLoadMore}
        reviewDecisionNotes={reviewDecisionNotes}
        setReviewDecisionNotes={setReviewDecisionNotes}
        governanceActionNotes={governanceActionNotes}
        setGovernanceActionNotes={setGovernanceActionNotes}
        guardrailsStats={guardrailsStats}
        guardrailsEvents={guardrailsEvents}
        handleGuardrailsModeChange={handleGuardrailsModeChange}
      />
      <LexConfirmModal />
    </div>
  );
}
