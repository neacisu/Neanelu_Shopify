import {
  RefreshCw,
  FolderOpen,
  Layers,
  Sparkles,
  Tag,
  Package,
  Languages,
  CircleOff,
  GitBranch,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Button } from '../components/ui/button';
import { SearchInput } from '../components/ui/SearchInput';
import { ProgressBar } from '../components/ui/progress-bar';
import { EmptyState } from '../components/patterns';
import { Badge } from '../components/ui/badge';
import { useApiClient } from '../hooks/use-api';
import { useScrollReveal } from '../hooks/useScrollReveal';

interface CollectionRow {
  id: string;
  shopify_gid: string;
  legacy_resource_id: number;
  title: string;
  title_en: string | null;
  handle: string;
  collection_type: string;
  products_count: number;
  taxonomy_count: number;
  taxonomy_name: string | null;
  synced_at: string | null;
  description: string | null;
  description_html: string | null;
  image_url: string | null;
  parent_collection_id: string | null;
  parent_title: string | null;
  menu_level: number | null;
  menu_path: string | null;
}

interface CollectionsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface CollectionsStats {
  total: number;
  manual: number;
  smart: number;
  withTaxonomy: number;
  translated: number;
  inMenu: number;
  roots: number;
  notInMenu: number;
  totalProducts: number;
  lastSyncedAt: string | null;
}

type SyncStatus = 'idle' | 'active' | 'completed' | 'failed' | 'waiting' | 'delayed';

interface SyncProgressPayload {
  fetched?: number;
  total?: number;
  percent?: number;
  phase?: string;
  current?: number;
  menuItems?: number;
  correlated?: number;
  hierarchyError?: boolean;
  status?: string;
}

interface SyncProgress {
  status: SyncStatus;
  progress: SyncProgressPayload | number | null;
  createdAt?: string | null;
  processedOn?: string | null;
  finishedOn?: string | null;
  failedReason?: string | null;
}

type SyncStepStatus = 'pending' | 'active' | 'done' | 'error';

interface SyncStepItem {
  key: string;
  label: string;
  detail: string;
  status: SyncStepStatus;
}

type SelectAllMode = 'page' | 'all' | null;

function formatRelativeDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const absMin = Math.abs(diffMin);
  const rtf = new Intl.RelativeTimeFormat('ro-RO', { numeric: 'auto' });
  if (absMin < 60) return rtf.format(diffMin, 'minute');
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function formatAbsoluteDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function parseMenuPath(menuPath: string | null): string[] {
  if (!menuPath) return [];
  return menuPath
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isRunningSyncStatus(status: SyncStatus): boolean {
  return status === 'active' || status === 'waiting' || status === 'delayed';
}

function getSyncPayload(progress: SyncProgress['progress']): SyncProgressPayload | null {
  if (!progress || typeof progress === 'number') return null;
  return progress;
}

function buildSyncSteps(syncState: SyncProgress): SyncStepItem[] {
  const payload = getSyncPayload(syncState.progress);
  const phase = payload?.phase ?? null;

  let currentStepIndex = -1;
  if (syncState.status === 'waiting' || syncState.status === 'delayed') {
    currentStepIndex = 0;
  } else if (phase === 'collections') {
    currentStepIndex = 1;
  } else if (phase === 'menus') {
    currentStepIndex = 2;
  } else if (phase === 'hierarchy') {
    currentStepIndex = 3;
  } else if (phase === 'done' || syncState.status === 'completed') {
    currentStepIndex = 4;
  } else if (syncState.status === 'failed') {
    currentStepIndex =
      phase === 'hierarchy' ? 3 : phase === 'menus' ? 2 : phase === 'collections' ? 1 : 0;
  }

  const resolveStepStatus = (index: number): SyncStepStatus => {
    if (syncState.status === 'completed' || currentStepIndex > index) return 'done';
    if (syncState.status === 'failed' && currentStepIndex === index) return 'error';
    if (currentStepIndex === index && isRunningSyncStatus(syncState.status)) return 'active';
    if (currentStepIndex === 4 && index <= 4) return 'done';
    return 'pending';
  };

  const menuCurrent = payload?.current ?? null;
  const menuTotal = payload?.total ?? null;
  const fetched = payload?.fetched ?? null;
  const menuItems = payload?.menuItems ?? null;
  const correlated = payload?.correlated ?? null;

  return [
    {
      key: 'queued',
      label: 'Job în coadă',
      detail:
        syncState.status === 'delayed'
          ? 'Job-ul așteaptă resursele worker-ului.'
          : syncState.createdAt
            ? `Creat la ${formatAbsoluteDateTime(syncState.createdAt)}`
            : 'Cererea de sincronizare a fost trimisă.',
      status: resolveStepStatus(0),
    },
    {
      key: 'collections',
      label: 'Import colecții',
      detail:
        fetched != null
          ? `${fetched.toLocaleString('ro-RO')} colecții importate`
          : 'Import paginat din Shopify.',
      status: resolveStepStatus(1),
    },
    {
      key: 'menus',
      label: 'Import meniuri Shopify',
      detail:
        menuCurrent != null && menuTotal != null
          ? `Meniu ${menuCurrent}/${menuTotal} procesat`
          : 'Se importă structura meniurilor.',
      status: resolveStepStatus(2),
    },
    {
      key: 'hierarchy',
      label: 'Corelare ierarhie categorii',
      detail:
        menuItems != null || correlated != null
          ? `${menuItems?.toLocaleString('ro-RO') ?? 0} itemi meniu, ${correlated?.toLocaleString('ro-RO') ?? 0} relații părinte-copil`
          : 'Se leagă colecțiile de structura categorii-produse.',
      status:
        payload?.hierarchyError === true && syncState.status !== 'completed'
          ? 'error'
          : resolveStepStatus(3),
    },
    {
      key: 'done',
      label: 'Finalizare și refresh UI',
      detail:
        syncState.finishedOn != null
          ? `Terminat la ${formatAbsoluteDateTime(syncState.finishedOn)}`
          : 'Se actualizează datele din interfață.',
      status: resolveStepStatus(4),
    },
  ];
}

function CategoryTreeCell({
  menuPath,
  currentTitle,
}: {
  menuPath: string | null;
  currentTitle: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const segments = useMemo(() => parseMenuPath(menuPath), [menuPath]);

  if (segments.length === 0) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  if (segments.length === 1) {
    return <span className="text-xs text-slate-600 dark:text-slate-300">{segments[0]}</span>;
  }

  const parentLabel = segments[segments.length - 2] ?? segments[0];

  return (
    <div className="min-w-[180px]" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="truncate">{expanded ? segments[0] : parentLabel}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {segments.map((segment, index) => {
            const isCurrent = index === segments.length - 1;
            return (
              <div
                key={`${segment}-${index}`}
                className={`flex items-center gap-1 text-xs ${
                  isCurrent
                    ? 'font-semibold text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                style={{ paddingLeft: `${index * 12}px` }}
              >
                {index > 0 && <span className="text-slate-300 dark:text-slate-600">└─</span>}
                <span className="truncate">{isCurrent ? currentTitle : segment}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CollectionsPage() {
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const limit = parseInt(searchParams.get('limit') ?? '25', 10) || 25;
  const search = searchParams.get('search') ?? '';
  const type = searchParams.get('type') ?? 'all';
  const hasTaxonomy = searchParams.get('hasTaxonomy') ?? 'all';
  const hasTranslation = searchParams.get('hasTranslation') ?? 'all';
  const menuLevel = searchParams.get('menuLevel') ?? 'all';
  const sortBy = searchParams.get('sortBy') ?? 'synced_at';
  const sortDir = searchParams.get('sortDir') ?? 'desc';

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [pagination, setPagination] = useState<CollectionsPagination | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  const [stats, setStats] = useState<CollectionsStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAllMode, setSelectAllMode] = useState<SelectAllMode>(null);
  const [selectedCollection, setSelectedCollection] = useState<CollectionRow | null>(null);

  const [syncState, setSyncState] = useState<SyncProgress>({
    status: 'idle',
    progress: null,
  });
  const [syncPanelHidden, setSyncPanelHidden] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncStatusRef = useRef<SyncStatus>('idle');
  const syncStartRef = useRef<number | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);

  const [bulkTaxonomyLoading, setBulkTaxonomyLoading] = useState(false);
  const [bulkMetafieldsLoading, setBulkMetafieldsLoading] = useState(false);
  const [bulkTranslateLoading, setBulkTranslateLoading] = useState(false);

  interface BulkCollectionStep {
    step: string;
    message: string;
    status: 'in_progress' | 'done' | 'error';
  }
  interface BulkCollectionEntry {
    collectionId: string;
    collectionTitle: string;
    steps: BulkCollectionStep[];
    finalStatus: 'running' | 'assigned' | 'low_confidence' | 'error';
    resultMessage: string | null;
    expanded: boolean;
  }
  const [bulkProgress, setBulkProgress] = useState<BulkCollectionEntry[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [translateProgress, setTranslateProgress] = useState<BulkCollectionEntry[]>([]);
  const [translateRunning, setTranslateRunning] = useState(false);

  const isSyncing =
    syncState.status === 'active' ||
    syncState.status === 'waiting' ||
    syncState.status === 'delayed';
  const showSyncPanel = syncState.status !== 'idle' && !syncPanelHidden;

  const breadcrumbs = useMemo(() => [{ label: 'Acasă', href: '/' }, { label: 'Colecții' }], []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (type !== 'all') params.set('type', type);
      if (hasTaxonomy !== 'all') params.set('hasTaxonomy', hasTaxonomy);
      if (hasTranslation !== 'all') params.set('hasTranslation', hasTranslation);
      if (menuLevel !== 'all') params.set('menuLevel', menuLevel);
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);

      const result = await api.getApi<{
        collections: CollectionRow[];
        pagination: CollectionsPagination;
      }>(`/collections?${params.toString()}`);

      setCollections(result.collections);
      setPagination(result.pagination);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la încărcare colecții');
    } finally {
      setCollectionsLoading(false);
    }
  }, [api, page, limit, search, type, hasTaxonomy, hasTranslation, menuLevel, sortBy, sortDir]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const result = await api.getApi<CollectionsStats>('/collections/stats');
      setStats(result);
    } catch {
      // best-effort
    } finally {
      setStatsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const stopElapsedTicker = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTicker = useCallback((startedAtMs: number) => {
    syncStartRef.current = startedAtMs;
    setSyncElapsedMs(Math.max(0, Date.now() - startedAtMs));
    if (elapsedTimerRef.current) return;
    elapsedTimerRef.current = setInterval(() => {
      if (syncStartRef.current == null) return;
      setSyncElapsedMs(Math.max(0, Date.now() - syncStartRef.current));
    }, 1000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    stopElapsedTicker();
  }, [stopElapsedTicker]);

  const pollSyncStatus = useCallback(async () => {
    try {
      const result = await api.getApi<SyncProgress>('/collections/sync/status');
      setSyncState(result);

      const previousStatus = lastSyncStatusRef.current;
      lastSyncStatusRef.current = result.status;

      if (isRunningSyncStatus(result.status)) {
        const startedAt =
          result.processedOn != null
            ? new Date(result.processedOn).getTime()
            : result.createdAt != null
              ? new Date(result.createdAt).getTime()
              : null;
        if (startedAt != null && Number.isFinite(startedAt)) {
          startElapsedTicker(startedAt);
        } else if (syncStartRef.current != null) {
          startElapsedTicker(syncStartRef.current);
        } else {
          startElapsedTicker(Date.now());
        }
      }

      if (result.status === 'completed') {
        stopPolling();
        if (previousStatus !== 'completed') {
          void loadCollections();
          void loadStats();
        }
        if (isRunningSyncStatus(previousStatus)) {
          toast.success('Sincronizare completă');
        }
      } else if (result.status === 'failed') {
        stopPolling();
        if (isRunningSyncStatus(previousStatus)) {
          toast.error(result.failedReason ?? 'Sincronizare eșuată');
        }
      }
      return result;
    } catch {
      // ignore polling errors
      return null;
    }
  }, [api, loadCollections, loadStats, startElapsedTicker, stopPolling]);

  const startPollingLoop = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void pollSyncStatus();
    }, 1500);
  }, [pollSyncStatus]);

  const startSync = useCallback(async () => {
    try {
      await api.postApi<{ queued: boolean; jobId: string }, Record<string, unknown>>(
        '/collections/sync',
        {}
      );
      setSyncState({ status: 'waiting', progress: null });
      setSyncPanelHidden(false);
      lastSyncStatusRef.current = 'waiting';
      stopPolling();
      startElapsedTicker(Date.now());
      void pollSyncStatus();
      startPollingLoop();
      toast.success('Sincronizare pornită');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la pornirea sincronizării');
    }
  }, [api, pollSyncStatus, startElapsedTicker, startPollingLoop, stopPolling]);

  useEffect(() => {
    void (async () => {
      const result = await pollSyncStatus();
      if (result && isRunningSyncStatus(result.status)) {
        startPollingLoop();
      }
    })();

    return () => stopPolling();
  }, [pollSyncStatus, startPollingLoop, stopPolling]);

  const updateSearchParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (key !== 'page') {
        next.delete('page');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return Array.from(set);
    });
    setSelectAllMode(null);
  }, []);

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(collections.map((c) => c.id));
        setSelectAllMode('page');
      } else {
        setSelectedIds([]);
        setSelectAllMode(null);
      }
    },
    [collections]
  );

  const handleExtendSelection = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (type !== 'all') params.set('type', type);
      if (hasTaxonomy !== 'all') params.set('hasTaxonomy', hasTaxonomy);
      if (hasTranslation !== 'all') params.set('hasTranslation', hasTranslation);
      if (menuLevel !== 'all') params.set('menuLevel', menuLevel);

      const result = await api.getApi<{ ids: string[]; total: number }>(
        `/collections/all-ids?${params.toString()}`
      );
      setSelectedIds(result.ids);
      setSelectAllMode('all');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la extinderea selecției');
    }
  }, [api, search, type, hasTaxonomy, hasTranslation, menuLevel]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectAllMode(null);
  }, []);

  const handleBulkAssignTaxonomy = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBulkTaxonomyLoading(true);
    setBulkRunning(true);
    setBulkProgress([]);

    try {
      await api.streamPost(
        '/collections/bulk/assign-taxonomy-ai',
        { collectionIds: selectedIds },
        (event) => {
          const type = event['type'] as string;

          if (type === 'collection_start') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            setBulkProgress((prev) => [
              ...prev.map((e) => (e.finalStatus === 'running' ? { ...e, expanded: false } : e)),
              {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: [],
                finalStatus: 'running',
                resultMessage: null,
                expanded: true,
              },
            ]);
          }

          if (type === 'collection_progress') {
            const cId = event['collectionId'] as string;
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status = (event['status'] as string) === 'done' ? 'done' : 'in_progress';
            setBulkProgress((prev) =>
              prev.map((entry) => {
                if (entry.collectionId !== cId) return entry;
                const existing = entry.steps.findIndex((s) => s.step === step);
                if (existing >= 0) {
                  const updated = [...entry.steps];
                  updated[existing] = { step, message, status };
                  return { ...entry, steps: updated };
                }
                return { ...entry, steps: [...entry.steps, { step, message, status }] };
              })
            );
          }

          if (type === 'collection_result') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            const status = event['status'] as 'assigned' | 'low_confidence' | 'error';
            const message = (event['message'] as string) ?? '';
            setBulkProgress((prev) => {
              const exists = prev.find((e) => e.collectionId === cId);
              if (exists) {
                return prev.map((e) =>
                  e.collectionId === cId
                    ? { ...e, finalStatus: status, resultMessage: message, expanded: false }
                    : e
                );
              }
              return [
                ...prev,
                {
                  collectionId: cId,
                  collectionTitle: cTitle,
                  steps: [],
                  finalStatus: status,
                  resultMessage: message,
                  expanded: false,
                },
              ];
            });
          }

          if (type === 'bulk_done') {
            setBulkRunning(false);
          }
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei');
    } finally {
      setBulkTaxonomyLoading(false);
      setBulkRunning(false);
      setSelectedIds([]);
      setSelectAllMode(null);
      void loadCollections();
      void loadStats();
    }
  }, [api, selectedIds, loadCollections, loadStats]);

  const handleBulkPushMetafields = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBulkMetafieldsLoading(true);
    try {
      await api.postApi('/collections/bulk/push-metafields', { collectionIds: selectedIds });
      toast.success(`Push metafields pornit pentru ${selectedIds.length} colecții`);
      setSelectedIds([]);
      setSelectAllMode(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la push metafields');
    } finally {
      setBulkMetafieldsLoading(false);
    }
  }, [api, selectedIds]);

  const runTranslateStream = useCallback(
    async (body: Record<string, unknown>) => {
      setBulkTranslateLoading(true);
      setTranslateRunning(true);
      setTranslateProgress([]);

      try {
        await api.streamPost('/collections/bulk/translate', body, (event) => {
          const type = event['type'] as string;

          if (type === 'translate_collection_start') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            setTranslateProgress((prev) => [
              ...prev.map((e) => (e.finalStatus === 'running' ? { ...e, expanded: false } : e)),
              {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: [],
                finalStatus: 'running',
                resultMessage: null,
                expanded: true,
              },
            ]);
          }

          if (type === 'translate_progress') {
            const cId = event['collectionId'] as string;
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status: 'in_progress' | 'done' | 'error' =
              (event['status'] as string) === 'done'
                ? 'done'
                : (event['status'] as string) === 'error'
                  ? 'error'
                  : 'in_progress';
            setTranslateProgress((prev) =>
              prev.map((entry) => {
                if (entry.collectionId !== cId) return entry;
                const existing = entry.steps.findIndex((s) => s.step === step);
                if (existing >= 0) {
                  const updated = [...entry.steps];
                  updated[existing] = { step, message, status };
                  return { ...entry, steps: updated };
                }
                return { ...entry, steps: [...entry.steps, { step, message, status }] };
              })
            );
          }

          if (type === 'translate_collection_result') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            const status = event['status'] as string;
            const titleEn = event['titleEn'] as string | undefined;
            const msg = titleEn ? `→ „${titleEn}"` : ((event['message'] as string) ?? 'Eroare');
            const finalStatus: 'assigned' | 'error' =
              status === 'translated' ? 'assigned' : 'error';
            setTranslateProgress((prev) => {
              const exists = prev.find((e) => e.collectionId === cId);
              if (exists) {
                return prev.map((e) =>
                  e.collectionId === cId
                    ? { ...e, finalStatus, resultMessage: msg, expanded: false }
                    : e
                );
              }
              return [
                ...prev,
                {
                  collectionId: cId,
                  collectionTitle: cTitle,
                  steps: [],
                  finalStatus,
                  resultMessage: msg,
                  expanded: false,
                },
              ];
            });
          }

          if (type === 'translate_done') {
            setTranslateRunning(false);
          }
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Eroare la traducere');
      } finally {
        setBulkTranslateLoading(false);
        setTranslateRunning(false);
        void loadCollections();
        void loadStats();
      }
    },
    [api, loadCollections, loadStats]
  );

  const handleBulkTranslate = useCallback(async () => {
    await runTranslateStream({});
  }, [runTranslateStream]);

  const handleBulkTranslateSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    await runTranslateStream({ collectionIds: selectedIds, force: true });
    setSelectedIds([]);
    setSelectAllMode(null);
  }, [runTranslateStream, selectedIds]);

  const handleSort = useCallback(
    (column: string) => {
      const next = new URLSearchParams(searchParams);
      if (sortBy === column) {
        next.set('sortDir', sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        next.set('sortBy', column);
        next.set('sortDir', 'desc');
      }
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, sortBy, sortDir]
  );

  const allOnPageSelected =
    collections.length > 0 && collections.every((c) => selectedIds.includes(c.id));
  const showExtendBanner = allOnPageSelected && pagination && pagination.total > collections.length;

  const syncPayload = useMemo(() => getSyncPayload(syncState.progress), [syncState.progress]);

  const syncProgress = useMemo(() => {
    if (syncState.status === 'completed') return 100;
    if (!syncState.progress) return 0;
    if (typeof syncState.progress === 'number') return syncState.progress;
    return syncState.progress.percent ?? 0;
  }, [syncState.progress, syncState.status]);

  const syncFetched = useMemo(() => syncPayload?.fetched ?? null, [syncPayload]);

  const syncPhaseLabel = useMemo(() => {
    if (syncState.status === 'waiting') {
      return 'Sincronizare pusă în coadă';
    }
    if (syncState.status === 'delayed') {
      return 'Sincronizare întârziată în coadă';
    }
    if (syncState.status === 'completed') {
      return 'Sincronizare Shopify finalizată';
    }
    if (syncState.status === 'failed') {
      return 'Sincronizare Shopify eșuată';
    }
    if (!syncPayload) {
      return 'Sincronizare în curs...';
    }
    if (syncPayload.phase === 'collections') {
      return syncFetched != null
        ? `Sincronizare colecții... (${syncFetched} importate)`
        : 'Sincronizare colecții...';
    }
    if (syncPayload.phase === 'menus') {
      const current = syncPayload.current;
      const totalMenus = syncPayload.total;
      return current != null && totalMenus != null
        ? `Sincronizare meniuri... (${current}/${totalMenus})`
        : 'Sincronizare meniuri...';
    }
    if (syncPayload.phase === 'hierarchy') {
      return syncPayload.status === 'completed'
        ? 'Corelare ierarhie finalizată'
        : 'Corelare ierarhie...';
    }
    if (syncPayload.phase === 'done') {
      return 'Sincronizare finalizată';
    }
    return 'Sincronizare în curs...';
  }, [syncFetched, syncPayload, syncState.status]);

  const syncSteps = useMemo(() => buildSyncSteps(syncState), [syncState]);

  const lastSyncLabel = useMemo(() => {
    if (!stats?.lastSyncedAt) return 'Ultima sincronizare completă: încă nu există.';
    return `Ultima sincronizare completă: ${formatAbsoluteDateTime(stats.lastSyncedAt)}`;
  }, [stats?.lastSyncedAt]);

  const canRestoreSyncPanel = syncState.status !== 'idle' && syncPanelHidden;

  const syncMetaLabel = useMemo(() => {
    if (syncState.status === 'failed') {
      return syncState.failedReason ?? 'Worker-ul a raportat o eroare.';
    }
    if (syncState.status === 'completed') {
      return syncState.finishedOn
        ? `Finalizată la ${formatAbsoluteDateTime(syncState.finishedOn)}`
        : 'Datele din tabel și KPI au fost reîmprospătate.';
    }
    if (syncState.status === 'waiting' || syncState.status === 'delayed') {
      return syncState.createdAt
        ? `Job creat la ${formatAbsoluteDateTime(syncState.createdAt)}`
        : 'Job-ul așteaptă procesarea în worker.';
    }
    if (syncPayload?.phase === 'done') {
      return 'Sincronizarea a intrat în faza finală de închidere.';
    }
    return 'Import live din Shopify cu urmărire pe faze.';
  }, [
    syncPayload?.phase,
    syncState.createdAt,
    syncState.failedReason,
    syncState.finishedOn,
    syncState.status,
  ]);

  const syncDurationLabel = useMemo(() => {
    if (syncElapsedMs > 0) return formatDuration(syncElapsedMs);
    if (!syncState.processedOn || !syncState.finishedOn) return '—';

    const startedAtMs = new Date(syncState.processedOn).getTime();
    const finishedAtMs = new Date(syncState.finishedOn).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) return '—';

    const durationMs = Math.max(0, finishedAtMs - startedAtMs);
    return durationMs > 0 ? formatDuration(durationMs) : '—';
  }, [syncElapsedMs, syncState.finishedOn, syncState.processedOn]);

  const [contentRef, contentVisible] = useScrollReveal<HTMLDivElement>({
    rootMargin: '0px 0px -40px 0px',
  });

  return (
    <div
      ref={contentRef}
      className="space-y-6 dark:text-slate-100"
      style={{
        animation: contentVisible ? 'fadeSlideUp 0.4s ease-out both' : 'none',
      }}
    >
      <Breadcrumbs items={breadcrumbs} />

      <PageHeader
        title="Gestionare Colecții"
        description="Sincronizează, clasifică și gestionează colecțiile Shopify."
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center gap-2">
              <Button variant="secondary" onClick={() => void startSync()} disabled={isSyncing}>
                <RefreshCw className={`mr-2 size-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Sincronizare...' : 'Sincronizează din Shopify'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleBulkTranslate()}
                disabled={bulkTranslateLoading}
              >
                <Languages className={`mr-2 size-4 ${translateRunning ? 'animate-pulse' : ''}`} />
                {translateRunning
                  ? `Se traduce (${translateProgress.filter((e) => e.finalStatus !== 'running').length}/${translateProgress.length})...`
                  : 'Traduce EN'}
              </Button>
              <InfoTooltip title="Sincronizare & traducere" side="bottom">
                Sincronizează colecțiile din Shopify, apoi traduce titlurile în engleză pentru o
                atribuire precisă a taxonomiei AI. Traducerea se face o singură dată.
              </InfoTooltip>
            </span>
            <button
              type="button"
              className={`text-xs ${
                canRestoreSyncPanel
                  ? 'text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                  : 'cursor-default text-slate-500 dark:text-slate-400'
              }`}
              onClick={() => {
                if (canRestoreSyncPanel) setSyncPanelHidden(false);
              }}
            >
              {lastSyncLabel}
            </button>
          </div>
        }
      />

      {/* Stats Cards */}
      {(() => {
        const simpleCards = [
          {
            label: 'Total colecții',
            value: stats?.total ?? 0,
            icon: FolderOpen,
            delay: 0,
            filterKey: 'all' as const,
          },
        ];

        const total = stats?.total ?? 0;
        const splitPairs: {
          top: {
            label: string;
            value: number;
            icon: typeof Tag;
            filterKey: string;
            filterParam: string;
            filterValue: string;
          };
          bottom: {
            label: string;
            value: number;
            icon: typeof CircleOff;
            filterKey: string;
            filterParam: string;
            filterValue: string;
          };
          delay: number;
        }[] = [
          {
            top: {
              label: 'Manuale',
              value: stats?.manual ?? 0,
              icon: Layers,
              filterKey: 'manual',
              filterParam: 'type',
              filterValue: 'MANUAL',
            },
            bottom: {
              label: 'Smart',
              value: stats?.smart ?? 0,
              icon: Sparkles,
              filterKey: 'smart',
              filterParam: 'type',
              filterValue: 'SMART',
            },
            delay: 1,
          },
          {
            top: {
              label: 'Cu taxonomie',
              value: stats?.withTaxonomy ?? 0,
              icon: Tag,
              filterKey: 'withTaxonomy',
              filterParam: 'hasTaxonomy',
              filterValue: 'true',
            },
            bottom: {
              label: 'Fără taxonomie',
              value: total - (stats?.withTaxonomy ?? 0),
              icon: CircleOff,
              filterKey: 'withoutTaxonomy',
              filterParam: 'hasTaxonomy',
              filterValue: 'false',
            },
            delay: 2,
          },
          {
            top: {
              label: 'Traduse EN',
              value: stats?.translated ?? 0,
              icon: Languages,
              filterKey: 'translated',
              filterParam: 'hasTranslation',
              filterValue: 'true',
            },
            bottom: {
              label: 'Fără traducere',
              value: total - (stats?.translated ?? 0),
              icon: CircleOff,
              filterKey: 'untranslated',
              filterParam: 'hasTranslation',
              filterValue: 'false',
            },
            delay: 3,
          },
          {
            top: {
              label: 'În meniu',
              value: stats?.inMenu ?? 0,
              icon: GitBranch,
              filterKey: 'inMenu',
              filterParam: 'menuLevel',
              filterValue: 'in_menu',
            },
            bottom: {
              label: 'Neclasificate',
              value: stats?.notInMenu ?? 0,
              icon: CircleOff,
              filterKey: 'notInMenu',
              filterParam: 'menuLevel',
              filterValue: 'none',
            },
            delay: 4,
          },
        ];

        const isCardActive = (filterKey: string) =>
          (filterKey === 'all' &&
            type === 'all' &&
            hasTaxonomy === 'all' &&
            hasTranslation === 'all' &&
            menuLevel === 'all') ||
          (filterKey === 'manual' && type === 'MANUAL') ||
          (filterKey === 'smart' && type === 'SMART') ||
          (filterKey === 'withTaxonomy' && hasTaxonomy === 'true') ||
          (filterKey === 'withoutTaxonomy' && hasTaxonomy === 'false') ||
          (filterKey === 'translated' && hasTranslation === 'true') ||
          (filterKey === 'untranslated' && hasTranslation === 'false') ||
          (filterKey === 'inMenu' && menuLevel === 'in_menu') ||
          (filterKey === 'notInMenu' && menuLevel === 'none');

        const applyFilter = (filterParam?: string, filterValue?: string) => {
          const next = new URLSearchParams(searchParams);
          next.delete('type');
          next.delete('hasTaxonomy');
          next.delete('hasTranslation');
          next.delete('menuLevel');
          next.set('page', '1');
          if (filterParam && filterValue) next.set(filterParam, filterValue);
          setSearchParams(next);
        };

        const cardBase = (active: boolean) =>
          `cursor-pointer overflow-hidden rounded-xl border shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] ${
            active
              ? 'border-blue-400 bg-blue-50/80 ring-1 ring-blue-400/30 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-500/20'
              : 'border-slate-200/90 bg-white/80 hover:border-slate-300/80 dark:border-slate-700/90 dark:bg-slate-900/80 dark:hover:border-slate-600/80'
          }`;

        const halfCardBase = (active: boolean) =>
          `cursor-pointer px-4 py-2 transition-colors duration-200 ${
            active
              ? 'bg-blue-50/80 dark:bg-blue-950/40'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }`;

        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {simpleCards.map((card) => {
              const active = isCardActive(card.filterKey);
              return (
                <article
                  key={card.label}
                  onClick={() => applyFilter()}
                  className={`${cardBase(active)} p-4`}
                  style={{
                    animation: statsLoading
                      ? 'none'
                      : `fadeSlideUp 0.4s ease-out ${card.delay * 0.1}s both`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-medium uppercase tracking-wider ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      {card.label}
                    </span>
                    <card.icon
                      className={`size-4 ${active ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}
                    />
                  </div>
                  <p
                    className={`mt-2 text-2xl font-bold ${active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-50'}`}
                  >
                    {statsLoading ? (
                      <span className="inline-block h-7 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                    ) : (
                      card.value.toLocaleString('ro-RO')
                    )}
                  </p>
                </article>
              );
            })}

            {splitPairs.map((pair) => {
              const topActive = isCardActive(pair.top.filterKey);
              const bottomActive = isCardActive(pair.bottom.filterKey);
              const wrapperActive = topActive || bottomActive;
              return (
                <div
                  key={pair.top.filterKey}
                  className={`${cardBase(wrapperActive)} flex flex-col`}
                  style={{
                    animation: statsLoading
                      ? 'none'
                      : `fadeSlideUp 0.4s ease-out ${pair.delay * 0.1}s both`,
                  }}
                >
                  <div
                    className={`${halfCardBase(topActive)} flex-1 rounded-t-xl`}
                    onClick={() => applyFilter(pair.top.filterParam, pair.top.filterValue)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider ${topActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {pair.top.label}
                      </span>
                      <pair.top.icon
                        className={`size-3.5 ${topActive ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold ${topActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-50'}`}
                    >
                      {statsLoading ? (
                        <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                      ) : (
                        pair.top.value.toLocaleString('ro-RO')
                      )}
                    </p>
                  </div>
                  <div className="border-t border-slate-200/60 dark:border-slate-700/60" />
                  <div
                    className={`${halfCardBase(bottomActive)} flex-1 rounded-b-xl`}
                    onClick={() => applyFilter(pair.bottom.filterParam, pair.bottom.filterValue)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider ${bottomActive ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}
                      >
                        {pair.bottom.label}
                      </span>
                      <pair.bottom.icon
                        className={`size-3.5 ${bottomActive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold ${bottomActive ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}
                    >
                      {statsLoading ? (
                        <span className="inline-block h-6 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                      ) : (
                        pair.bottom.value.toLocaleString('ro-RO')
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Sync Progress */}
      {showSyncPanel && (
        <div
          className={`rounded-xl border p-4 shadow-sm ${
            syncState.status === 'failed'
              ? 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'
              : syncState.status === 'completed'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {syncState.status === 'completed' ? (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : syncState.status === 'failed' ? (
                  <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
                ) : syncState.status === 'waiting' || syncState.status === 'delayed' ? (
                  <Clock3 className="size-4 text-blue-600 dark:text-blue-400" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-blue-600 dark:text-blue-400" />
                )}
                <span
                  className={`text-sm font-semibold ${
                    syncState.status === 'failed'
                      ? 'text-rose-700 dark:text-rose-300'
                      : syncState.status === 'completed'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-blue-700 dark:text-blue-300'
                  }`}
                >
                  {syncPhaseLabel}
                </span>
                <button
                  type="button"
                  className="ml-1 inline-flex size-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-900/70 dark:hover:text-slate-200"
                  onClick={() => setSyncPanelHidden(true)}
                  aria-label="Ascunde panoul de sincronizare"
                  title="Ascunde"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{syncMetaLabel}</p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="text-right">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {Math.round(syncProgress)}%
                </div>
                <div className="text-slate-500 dark:text-slate-400">progres</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {syncDurationLabel}
                </div>
                <div className="text-slate-500 dark:text-slate-400">durată</div>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <ProgressBar progress={syncProgress} />
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-xs dark:border-slate-800/80 dark:bg-slate-900/60">
              <div className="text-slate-500 dark:text-slate-400">Colecții importate</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                {syncFetched != null ? syncFetched.toLocaleString('ro-RO') : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-xs dark:border-slate-800/80 dark:bg-slate-900/60">
              <div className="text-slate-500 dark:text-slate-400">Itemi meniu</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                {syncPayload?.menuItems != null
                  ? syncPayload.menuItems.toLocaleString('ro-RO')
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-xs dark:border-slate-800/80 dark:bg-slate-900/60">
              <div className="text-slate-500 dark:text-slate-400">Relații corelate</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                {syncPayload?.correlated != null
                  ? syncPayload.correlated.toLocaleString('ro-RO')
                  : '—'}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {syncSteps.map((step) => (
              <div
                key={step.key}
                className="flex items-start gap-3 rounded-lg border border-white/60 bg-white/70 px-3 py-2 dark:border-slate-800/80 dark:bg-slate-900/60"
              >
                <span className="mt-0.5">
                  {step.status === 'done' ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : step.status === 'error' ? (
                    <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400" />
                  ) : step.status === 'active' ? (
                    <LoaderCircle className="size-4 animate-spin text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Clock3 className="size-4 text-slate-400 dark:text-slate-500" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {step.label}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(val) => updateSearchParam('search', val)}
          placeholder="Caută colecții..."
          loading={collectionsLoading}
        />
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          value={type}
          onChange={(e) => updateSearchParam('type', e.target.value)}
        >
          <option value="all">Toate tipurile</option>
          <option value="MANUAL">Manual</option>
          <option value="SMART">Smart</option>
        </select>
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          value={hasTaxonomy}
          onChange={(e) => updateSearchParam('hasTaxonomy', e.target.value)}
        >
          <option value="all">Orice taxonomie</option>
          <option value="true">Cu taxonomie</option>
          <option value="false">Fără taxonomie</option>
        </select>
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          value={menuLevel}
          onChange={(e) => updateSearchParam('menuLevel', e.target.value)}
        >
          <option value="all">Orice nivel</option>
          <option value="in_menu">În meniu</option>
          <option value="0">Root (părinte)</option>
          <option value="1">Nivel 1</option>
          <option value="2">Nivel 2</option>
          <option value="none">Neclasificate</option>
        </select>
        <select
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          value={limit}
          onChange={(e) => updateSearchParam('limit', e.target.value)}
        >
          <option value="10">10 / pagină</option>
          <option value="25">25 / pagină</option>
          <option value="50">50 / pagină</option>
          <option value="100">100 / pagină</option>
        </select>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-30 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm dark:border-blue-800 dark:bg-blue-950/50">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {selectedIds.length}{' '}
            {selectedIds.length === 1 ? 'colecție selectată' : 'colecții selectate'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void handleBulkAssignTaxonomy()}
              disabled={bulkTaxonomyLoading}
            >
              {bulkRunning
                ? `Se atribuie (${bulkProgress.filter((e) => e.finalStatus !== 'running').length}/${bulkProgress.length})...`
                : 'Atribuie taxonomie AI'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleBulkTranslateSelected()}
              disabled={bulkTranslateLoading}
            >
              <Languages className={`mr-1.5 size-3.5 ${translateRunning ? 'animate-pulse' : ''}`} />
              {translateRunning
                ? `Se traduce (${translateProgress.filter((e) => e.finalStatus !== 'running').length}/${translateProgress.length})...`
                : 'Traduce EN'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleBulkPushMetafields()}
              disabled={bulkMetafieldsLoading}
            >
              {bulkMetafieldsLoading ? 'Se trimit...' : 'Push metafields'}
            </Button>
            <Button variant="ghost" onClick={handleClearSelection}>
              Șterge selecția
            </Button>
          </div>
        </div>
      )}

      {/* Select All Banner */}
      {showExtendBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm dark:border-amber-800 dark:bg-amber-950/50">
          {selectAllMode === 'all' ? (
            <>
              <span className="text-amber-800 dark:text-amber-200">
                Toate cele {pagination.total.toLocaleString('ro-RO')} colecții sunt selectate.
              </span>{' '}
              <button
                className="font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                onClick={() => handleToggleAll(true)}
              >
                Selectează doar pagina curentă
              </button>
            </>
          ) : (
            <>
              <span className="text-amber-800 dark:text-amber-200">
                Toate cele {collections.length} colecții de pe pagină sunt selectate.
              </span>{' '}
              <button
                className="font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                onClick={() => void handleExtendSelection()}
              >
                Extinde selecția la toate cele {pagination.total.toLocaleString('ro-RO')} colecții
              </button>
            </>
          )}
        </div>
      )}

      {/* Bulk AI Taxonomy Progress Panel */}
      {bulkProgress.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {bulkRunning
                ? 'Atribuire taxonomii AI în curs...'
                : `Atribuire completă — ${bulkProgress.filter((e) => e.finalStatus === 'assigned').length} atribuite, ${bulkProgress.filter((e) => e.finalStatus === 'low_confidence').length} conf. scăzută, ${bulkProgress.filter((e) => e.finalStatus === 'error').length} erori`}
            </h3>
            {!bulkRunning && (
              <button
                onClick={() => setBulkProgress([])}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Închide
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {bulkProgress.map((entry) => (
              <div
                key={entry.collectionId}
                className="rounded border border-slate-100 dark:border-slate-800"
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() =>
                    setBulkProgress((prev) =>
                      prev.map((e) =>
                        e.collectionId === entry.collectionId ? { ...e, expanded: !e.expanded } : e
                      )
                    )
                  }
                >
                  <span className="flex-shrink-0">
                    {entry.finalStatus === 'running' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    )}
                    {entry.finalStatus === 'assigned' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] text-white">
                        &#10003;
                      </span>
                    )}
                    {entry.finalStatus === 'low_confidence' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] text-white">
                        !
                      </span>
                    )}
                    {entry.finalStatus === 'error' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">
                        &#10007;
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate font-medium text-slate-700 dark:text-slate-300">
                    {entry.collectionTitle}
                  </span>
                  {entry.resultMessage && !entry.expanded && (
                    <span
                      className={`truncate text-xs ${entry.finalStatus === 'assigned' ? 'text-green-600 dark:text-green-400' : entry.finalStatus === 'error' ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}
                    >
                      {entry.resultMessage}
                    </span>
                  )}
                  <span
                    className={`text-xs text-slate-400 transition-transform ${entry.expanded ? 'rotate-180' : ''}`}
                  >
                    &#9660;
                  </span>
                </button>
                {entry.expanded && entry.steps.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
                    <ul className="space-y-1">
                      {entry.steps.map((s, si) => (
                        <li key={`${s.step}-${si}`} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 flex-shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-500 border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-green-500 text-[8px] text-white">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span
                            className={
                              s.status === 'error'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-600 dark:text-slate-400'
                            }
                          >
                            {s.message}
                          </span>
                        </li>
                      ))}
                      {entry.resultMessage && (
                        <li
                          className={`mt-1 text-xs font-medium ${entry.finalStatus === 'assigned' ? 'text-green-700 dark:text-green-400' : entry.finalStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
                        >
                          {entry.resultMessage}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Translate Progress Panel */}
      {translateProgress.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {translateRunning
                ? 'Traducere în curs...'
                : `Traducere completă — ${translateProgress.filter((e) => e.finalStatus === 'assigned').length} traduse, ${translateProgress.filter((e) => e.finalStatus === 'error').length} erori`}
            </h3>
            {!translateRunning && (
              <button
                onClick={() => setTranslateProgress([])}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Închide
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {translateProgress.map((entry) => (
              <div
                key={entry.collectionId}
                className="rounded border border-slate-100 dark:border-slate-800"
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() =>
                    setTranslateProgress((prev) =>
                      prev.map((e) =>
                        e.collectionId === entry.collectionId ? { ...e, expanded: !e.expanded } : e
                      )
                    )
                  }
                >
                  <span className="flex-shrink-0">
                    {entry.finalStatus === 'running' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    )}
                    {entry.finalStatus === 'assigned' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] text-white">
                        &#10003;
                      </span>
                    )}
                    {entry.finalStatus === 'error' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">
                        &#10007;
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate font-medium text-slate-700 dark:text-slate-300">
                    {entry.collectionTitle}
                  </span>
                  {entry.resultMessage && !entry.expanded && (
                    <span
                      className={`truncate text-xs ${entry.finalStatus === 'assigned' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
                    >
                      {entry.resultMessage}
                    </span>
                  )}
                  <span
                    className={`text-xs text-slate-400 transition-transform ${entry.expanded ? 'rotate-180' : ''}`}
                  >
                    &#9660;
                  </span>
                </button>
                {entry.expanded && entry.steps.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
                    <ul className="space-y-1">
                      {entry.steps.map((s, si) => (
                        <li key={`${s.step}-${si}`} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 flex-shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-500 border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-green-500 text-[8px] text-white">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span
                            className={
                              s.status === 'error'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-600 dark:text-slate-400'
                            }
                          >
                            {s.message}
                          </span>
                        </li>
                      ))}
                      {entry.resultMessage && (
                        <li
                          className={`mt-1 text-xs font-medium ${entry.finalStatus === 'assigned' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {entry.resultMessage}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collections Table */}
      {collections.length === 0 && !collectionsLoading ? (
        <EmptyState
          title="Nu există colecții"
          description="Sincronizează din Shopify pentru a importa colecțiile."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected && collections.length > 0}
                    onChange={(e) => handleToggleAll(e.target.checked)}
                    className="size-4 rounded border-slate-300 dark:border-slate-600"
                  />
                </th>
                {[
                  { key: 'title', label: 'Titlu' },
                  { key: 'collection_type', label: 'Tip' },
                  { key: 'products_count', label: 'Produse' },
                  { key: 'menu_level', label: 'Nivel' },
                  { key: '', label: 'Categorii' },
                  { key: '', label: 'Taxonomie' },
                  { key: 'synced_at', label: 'Sincronizat' },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={`px-3 py-3 text-left font-medium text-slate-600 dark:text-slate-300 ${
                      col.key
                        ? 'cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-100'
                        : ''
                    }`}
                    onClick={() => col.key && handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && sortBy === col.key && (
                        <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {collectionsLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-${i}`}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                        </td>
                      ))}
                    </tr>
                  ))
                : collections.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      onClick={() => setSelectedCollection(c)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.id)}
                          onChange={() => handleToggle(c.id)}
                          className="size-4 rounded border-slate-300 dark:border-slate-600"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          {c.image_url ? (
                            <img src={c.image_url} alt="" className="size-8 rounded object-cover" />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded bg-slate-100 dark:bg-slate-800">
                              <Package className="size-4 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="block truncate">{c.title}</span>
                            {c.title_en && (
                              <span className="block truncate text-xs font-normal italic text-slate-400 dark:text-slate-500">
                                {c.title_en}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={c.collection_type === 'SMART' ? 'info' : 'neutral'}>
                          {c.collection_type}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                        {c.products_count.toLocaleString('ro-RO')}
                      </td>
                      <td className="px-3 py-3">
                        {c.menu_level === null ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            —
                          </span>
                        ) : c.menu_level === 0 ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Root
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            Nivel {c.menu_level}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <CategoryTreeCell menuPath={c.menu_path} currentTitle={c.title} />
                      </td>
                      <td className="px-3 py-3">
                        {c.taxonomy_name ? (
                          <span className="text-green-700 dark:text-green-400">
                            {c.taxonomy_name}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                        {formatRelativeDate(c.synced_at)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Pagina {pagination.page} din {pagination.totalPages} (
                {pagination.total.toLocaleString('ro-RO')} colecții)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={!pagination.hasPrev}
                  onClick={() => updateSearchParam('page', '1')}
                >
                  Prima
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasPrev}
                  onClick={() => updateSearchParam('page', String(pagination.page - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasNext}
                  onClick={() => updateSearchParam('page', String(pagination.page + 1))}
                >
                  Următor
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasNext}
                  onClick={() => updateSearchParam('page', String(pagination.totalPages))}
                >
                  Ultima
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collection Detail Drawer */}
      {selectedCollection && (
        <CollectionDetailDrawerInline
          collection={selectedCollection}
          api={api}
          onSelectCollection={setSelectedCollection}
          onClose={() => setSelectedCollection(null)}
          onRefresh={() => {
            void loadCollections();
            void loadStats();
          }}
        />
      )}
    </div>
  );
}

interface DrawerProps {
  collection: CollectionRow;
  api: ReturnType<typeof useApiClient>;
  onSelectCollection: (collection: CollectionRow) => void;
  onClose: () => void;
  onRefresh: () => void;
}

function CollectionDetailDrawerInline({
  collection,
  api,
  onSelectCollection,
  onClose,
  onRefresh,
}: DrawerProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'taxonomy' | 'metafields'>('products');
  const [products, setProducts] = useState<
    { id: string; title: string; products_count?: number; quality_level?: string }[]
  >([]);
  const [metafields, setMetafields] = useState<Record<string, unknown> | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMetafields, setLoadingMetafields] = useState(false);
  const [taxonomyName, setTaxonomyName] = useState<string | null>(collection.taxonomy_name);

  useEffect(() => {
    setActiveTab('products');
    setProducts([]);
    setMetafields(null);
    setTaxonomyName(collection.taxonomy_name);
  }, [collection.id, collection.taxonomy_name]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const result = await api.getApi<{ products: typeof products }>(
        `/collections/${collection.id}/products`
      );
      setProducts(result.products);
    } catch {
      toast.error('Eroare la încărcare produse');
    } finally {
      setLoadingProducts(false);
    }
  }, [api, collection.id]);

  const loadMetafields = useCallback(async () => {
    setLoadingMetafields(true);
    try {
      const result = await api.getApi<{ metafields: Record<string, unknown> }>(
        `/collections/${collection.id}/metafields`
      );
      setMetafields(result.metafields);
    } catch {
      toast.error('Eroare la încărcare metafields');
    } finally {
      setLoadingMetafields(false);
    }
  }, [api, collection.id]);

  const handleOpenParent = useCallback(async () => {
    if (!collection.parent_collection_id) return;
    try {
      const result = await api.getApi<{ collection: CollectionRow }>(
        `/collections/${collection.parent_collection_id}`
      );
      onSelectCollection(result.collection);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la încărcarea colecției părinte');
    }
  }, [api, collection.parent_collection_id, onSelectCollection]);

  useEffect(() => {
    if (activeTab === 'products') void loadProducts();
    if (activeTab === 'metafields') void loadMetafields();
  }, [activeTab, loadProducts, loadMetafields]);

  interface ProgressStep {
    step: string;
    message: string;
    status: 'in_progress' | 'done' | 'error';
  }
  const [assignRunning, setAssignRunning] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);

  const [titleEn, setTitleEn] = useState<string | null>(collection.title_en ?? null);
  const [translateRunningLocal, setTranslateRunningLocal] = useState(false);
  const [translateSteps, setTranslateSteps] = useState<ProgressStep[]>([]);

  useEffect(() => {
    setTitleEn(collection.title_en ?? null);
    setTranslateSteps([]);
  }, [collection.id, collection.title_en]);

  const handleTranslateSingle = useCallback(async () => {
    setTranslateRunningLocal(true);
    setTranslateSteps([]);
    try {
      await api.streamPost(
        `/collections/${collection.id}/translate`,
        { force: !!titleEn },
        (event) => {
          const type = event['type'] as string;

          if (type === 'progress') {
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status: 'in_progress' | 'done' | 'error' =
              (event['status'] as string) === 'done'
                ? 'done'
                : (event['status'] as string) === 'error'
                  ? 'error'
                  : 'in_progress';
            setTranslateSteps((prev) => {
              const existing = prev.findIndex((s) => s.step === step);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { step, message, status };
                return updated;
              }
              return [...prev, { step, message, status }];
            });
          }

          if (type === 'result') {
            const resultStatus = event['status'] as string;
            if (resultStatus === 'translated') {
              const translated = event['titleEn'] as string;
              setTitleEn(translated);
              setTranslateSteps((prev) => [
                ...prev,
                { step: 'done', message: `Traducere finalizată: „${translated}"`, status: 'done' },
              ]);
              onRefresh();
            } else if (resultStatus === 'already_translated') {
              setTitleEn(event['titleEn'] as string);
            } else {
              setTranslateSteps((prev) => [
                ...prev,
                {
                  step: 'fail',
                  message: (event['message'] as string) ?? 'Traducerea nu a reușit.',
                  status: 'error',
                },
              ]);
            }
          }

          if (type === 'error') {
            setTranslateSteps((prev) => [
              ...prev,
              {
                step: 'error',
                message: (event['message'] as string) ?? 'Eroare la traducere.',
                status: 'error',
              },
            ]);
          }
        }
      );
    } catch (err) {
      setTranslateSteps((prev) => [
        ...prev,
        {
          step: 'error',
          message: err instanceof Error ? err.message : 'Eroare la traducere.',
          status: 'error',
        },
      ]);
    } finally {
      setTranslateRunningLocal(false);
    }
  }, [api, collection.id, onRefresh]);

  const handleAssignTaxonomyAi = useCallback(async () => {
    setAssignRunning(true);
    setProgressSteps([]);
    if (taxonomyName) {
      setTaxonomyName(null);
    }

    try {
      await api.streamPost(`/collections/${collection.id}/assign-taxonomy-ai`, {}, (event) => {
        const type = event['type'] as string;

        if (type === 'progress') {
          const step = event['step'] as string;
          const message = event['message'] as string;
          const status = (event['status'] as string) === 'done' ? 'done' : 'in_progress';
          setProgressSteps((prev) => {
            const existing = prev.findIndex((s) => s.step === step);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { step, message, status };
              return updated;
            }
            return [...prev, { step, message, status }];
          });
        }

        if (type === 'result') {
          const resultStatus = event['status'] as string;
          if (resultStatus === 'assigned') {
            const name = event['taxonomyName'] as string;
            const pct = Math.round(((event['confidence'] as number) ?? 0) * 100);
            setTaxonomyName(name);
            setProgressSteps((prev) => [
              ...prev,
              {
                step: 'done',
                message: `Taxonomie atribuită: „${name}" — ${pct}% confidență`,
                status: 'done',
              },
            ]);
            onRefresh();
          } else {
            const msg = (event['message'] as string) ?? 'Confidență scăzută. Atribuiți manual.';
            setProgressSteps((prev) => [
              ...prev,
              { step: 'low_conf', message: msg, status: 'error' },
            ]);
          }
        }

        if (type === 'error') {
          const msg = (event['message'] as string) ?? 'Eroare la atribuirea taxonomiei.';
          setProgressSteps((prev) => [...prev, { step: 'error', message: msg, status: 'error' }]);
        }
      });
    } catch (err) {
      setProgressSteps((prev) => [
        ...prev,
        {
          step: 'error',
          message: err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei.',
          status: 'error',
        },
      ]);
    } finally {
      setAssignRunning(false);
    }
  }, [api, collection.id, taxonomyName, onRefresh]);

  const handlePushMetafields = useCallback(async () => {
    try {
      await api.postApi(`/collections/${collection.id}/push-metafields`, {});
      toast.success('Push metafields pornit');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la push metafields');
    }
  }, [api, collection.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        className="flex h-full w-[500px] flex-col border-l border-white/20 bg-white/90 shadow-xl backdrop-blur-xl motion-safe:animate-[slideInRight_0.3s_ease-out] dark:border-slate-800/90 dark:bg-slate-900/95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {collection.title}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {collection.collection_type} · {collection.products_count} produse
            </p>
            {collection.menu_path && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                {parseMenuPath(collection.menu_path).map((segment, i, arr) => (
                  <span key={`${segment}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3" />}
                    <span
                      className={
                        i === arr.length - 1
                          ? 'font-medium text-slate-600 dark:text-slate-300'
                          : undefined
                      }
                    >
                      {segment}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {collection.parent_title && collection.parent_collection_id && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                onClick={() => void handleOpenParent()}
              >
                <ChevronRight className="size-3" />
                Deschide părintele: {collection.parent_title}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {(['products', 'taxonomy', 'metafields'] as const).map((tab) => (
            <button
              key={tab}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'products' ? 'Produse' : tab === 'taxonomy' ? 'Taxonomie' : 'Metafields'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'products' && (
            <div className="space-y-3">
              {loadingProducts ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                    />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Niciun produs în această colecție.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-800 dark:text-slate-200">{p.title}</span>
                      {p.quality_level && <Badge tone="neutral">{p.quality_level}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'taxonomy' && (
            <div className="space-y-4">
              {/* Traducere EN */}
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Traducere EN
                </h3>
                {titleEn ? (
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    „{titleEn}"
                  </p>
                ) : translateRunningLocal ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Se traduce...</p>
                ) : (
                  <p className="text-sm text-slate-400">Netradusă</p>
                )}
                {translateSteps.length > 0 && (
                  <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <ul className="space-y-1.5">
                      {translateSteps.map((s, i) => (
                        <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 flex-shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] text-white">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span
                            className={
                              s.status === 'error'
                                ? 'text-red-600 dark:text-red-400'
                                : s.status === 'done'
                                  ? 'text-green-700 dark:text-green-400'
                                  : 'text-slate-700 dark:text-slate-300'
                            }
                          >
                            {s.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleTranslateSingle()}
                    disabled={translateRunningLocal || assignRunning}
                  >
                    <Languages
                      className={`mr-1.5 size-3.5 ${translateRunningLocal ? 'animate-pulse' : ''}`}
                    />
                    {translateRunningLocal
                      ? 'Se traduce...'
                      : titleEn
                        ? 'Retraduce cu AI'
                        : 'Traduce cu AI'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Taxonomie atribuită
                </h3>
                {taxonomyName ? (
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {taxonomyName}
                  </p>
                ) : assignRunning ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Se procesează...</p>
                ) : (
                  <p className="text-sm text-slate-400">Nicio taxonomie atribuită</p>
                )}
              </div>

              {progressSteps.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Progres operații
                  </h4>
                  <ul className="space-y-2">
                    {progressSteps.map((s, i) => (
                      <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 flex-shrink-0">
                          {s.status === 'in_progress' && (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                          )}
                          {s.status === 'done' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] text-white">
                              &#10003;
                            </span>
                          )}
                          {s.status === 'error' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                              &#10007;
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            s.status === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : s.status === 'done'
                                ? 'text-green-700 dark:text-green-400'
                                : 'text-slate-700 dark:text-slate-300'
                          }
                        >
                          {s.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleAssignTaxonomyAi()}
                  disabled={assignRunning}
                >
                  {assignRunning
                    ? 'Se procesează...'
                    : taxonomyName
                      ? 'Reatribuie cu AI'
                      : 'Atribuie cu AI'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handlePushMetafields()}
                  disabled={!taxonomyName || assignRunning}
                >
                  Push metafields
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'metafields' && (
            <div>
              {loadingMetafields ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-8 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                    />
                  ))}
                </div>
              ) : metafields ? (
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-100 p-4 text-xs dark:bg-slate-800">
                  {JSON.stringify(metafields, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nu există metafields.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
