import { RefreshCw, FolderOpen, Layers, Sparkles, Tag, Package } from 'lucide-react';
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
  handle: string;
  collection_type: string;
  products_count: number;
  taxonomy_count: number;
  taxonomy_name: string | null;
  synced_at: string | null;
  description: string | null;
  description_html: string | null;
  image_url: string | null;
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
  totalProducts: number;
  lastSyncedAt: string | null;
}

type SyncStatus = 'idle' | 'active' | 'completed' | 'failed' | 'waiting' | 'delayed';

interface SyncProgress {
  status: SyncStatus;
  progress: { fetched?: number; total?: number; percent?: number } | number | null;
  createdAt?: string | null;
  processedOn?: string | null;
  finishedOn?: string | null;
  failedReason?: string | null;
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function CollectionsPage() {
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const limit = parseInt(searchParams.get('limit') ?? '25', 10) || 25;
  const search = searchParams.get('search') ?? '';
  const type = searchParams.get('type') ?? 'all';
  const hasTaxonomy = searchParams.get('hasTaxonomy') ?? 'all';
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const syncStartRef = useRef<number | null>(null);

  const [bulkTaxonomyLoading, setBulkTaxonomyLoading] = useState(false);
  const [bulkMetafieldsLoading, setBulkMetafieldsLoading] = useState(false);

  const isSyncing =
    syncState.status === 'active' ||
    syncState.status === 'waiting' ||
    syncState.status === 'delayed';

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
  }, [api, page, limit, search, type, hasTaxonomy, sortBy, sortDir]);

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

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollSyncStatus = useCallback(async () => {
    try {
      const result = await api.getApi<SyncProgress>('/collections/sync/status');
      setSyncState(result);
      if (syncStartRef.current) {
        elapsedRef.current = Date.now() - syncStartRef.current;
      }
      if (result.status === 'completed') {
        stopPolling();
        syncStartRef.current = null;
        toast.success('Sincronizare completă');
        void loadCollections();
        void loadStats();
      } else if (result.status === 'failed') {
        stopPolling();
        syncStartRef.current = null;
        toast.error(result.failedReason ?? 'Sincronizare eșuată');
      }
    } catch {
      // ignore polling errors
    }
  }, [api, stopPolling, loadCollections, loadStats]);

  const startSync = useCallback(async () => {
    try {
      await api.postApi<{ queued: boolean; jobId: string }, Record<string, unknown>>(
        '/collections/sync',
        {}
      );
      setSyncState({ status: 'waiting', progress: null });
      syncStartRef.current = Date.now();
      elapsedRef.current = 0;
      stopPolling();
      pollRef.current = setInterval(() => {
        void pollSyncStatus();
      }, 2000);
      toast.success('Sincronizare pornită');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la pornirea sincronizării');
    }
  }, [api, stopPolling, pollSyncStatus]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

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

      const result = await api.getApi<{ ids: string[]; total: number }>(
        `/collections/all-ids?${params.toString()}`
      );
      setSelectedIds(result.ids);
      setSelectAllMode('all');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la extinderea selecției');
    }
  }, [api, search, type, hasTaxonomy]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectAllMode(null);
  }, []);

  const handleBulkAssignTaxonomy = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBulkTaxonomyLoading(true);
    try {
      await api.postApi('/collections/bulk/assign-taxonomy-ai', { collectionIds: selectedIds });
      toast.success(`Taxonomie AI atribuită pentru ${selectedIds.length} colecții`);
      setSelectedIds([]);
      setSelectAllMode(null);
      void loadCollections();
      void loadStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei');
    } finally {
      setBulkTaxonomyLoading(false);
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

  const syncProgress = useMemo(() => {
    if (!syncState.progress) return 0;
    if (typeof syncState.progress === 'number') return syncState.progress;
    return syncState.progress.percent ?? 0;
  }, [syncState.progress]);

  const syncFetched = useMemo(() => {
    if (!syncState.progress || typeof syncState.progress === 'number') return null;
    return syncState.progress.fetched ?? null;
  }, [syncState.progress]);

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
          <span className="inline-flex items-center gap-1.5">
            <Button variant="secondary" onClick={() => void startSync()} disabled={isSyncing}>
              <RefreshCw className={`mr-2 size-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizare...' : 'Sincronizează din Shopify'}
            </Button>
            <InfoTooltip title="Sincronizare colecții" side="bottom">
              Importă/actualizează colecțiile din Shopify. Procesul rulează în fundal și
              actualizează tabelul automat la finalizare.
            </InfoTooltip>
          </span>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Total colecții',
            value: stats?.total ?? 0,
            icon: FolderOpen,
            delay: 0,
          },
          {
            label: 'Manuale',
            value: stats?.manual ?? 0,
            icon: Layers,
            delay: 1,
          },
          {
            label: 'Smart',
            value: stats?.smart ?? 0,
            icon: Sparkles,
            delay: 2,
          },
          {
            label: 'Cu taxonomie',
            value: stats?.withTaxonomy ?? 0,
            icon: Tag,
            delay: 3,
          },
        ].map((card) => (
          <article
            key={card.label}
            className="group/kpi overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-slate-300/80 hover:shadow-[var(--shadow-md)] dark:border-slate-700/90 dark:bg-slate-900/80 dark:hover:border-slate-600/80"
            style={{
              animation: statsLoading
                ? 'none'
                : `fadeSlideUp 0.4s ease-out ${card.delay * 0.1}s both`,
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {card.label}
              </span>
              <card.icon className="size-4 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
              {statsLoading ? (
                <span className="inline-block h-7 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              ) : (
                card.value.toLocaleString('ro-RO')
              )}
            </p>
          </article>
        ))}
      </div>

      {/* Sync Progress */}
      {isSyncing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/50">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-blue-700 dark:text-blue-300">
              Sincronizare în curs...
              {syncFetched != null && ` (${syncFetched} colecții procesate)`}
            </span>
            {elapsedRef.current > 0 && (
              <span className="text-blue-600 dark:text-blue-400">
                {formatDuration(elapsedRef.current)}
              </span>
            )}
          </div>
          <ProgressBar progress={syncProgress} />
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
              {bulkTaxonomyLoading ? 'Se atribuie...' : 'Atribuie taxonomie AI'}
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
                      {Array.from({ length: 6 }).map((__, j) => (
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
                          <span className="truncate">{c.title}</span>
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
  onClose: () => void;
  onRefresh: () => void;
}

function CollectionDetailDrawerInline({ collection, api, onClose, onRefresh }: DrawerProps) {
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

  useEffect(() => {
    if (activeTab === 'products') void loadProducts();
    if (activeTab === 'metafields') void loadMetafields();
  }, [activeTab, loadProducts, loadMetafields]);

  const handleAssignTaxonomyAi = useCallback(async () => {
    try {
      await api.postApi('/collections/bulk/assign-taxonomy-ai', {
        collectionIds: [collection.id],
      });
      toast.success('Taxonomie AI atribuită');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei');
    }
  }, [api, collection.id, onRefresh]);

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
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Taxonomie atribuită
                </h3>
                {taxonomyName ? (
                  <p className="text-sm text-green-700 dark:text-green-400">{taxonomyName}</p>
                ) : (
                  <p className="text-sm text-slate-400">Nicio taxonomie atribuită</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void handleAssignTaxonomyAi()}>
                  Atribuie cu AI
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handlePushMetafields()}
                  disabled={!taxonomyName}
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
