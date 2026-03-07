import { Filter, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import type {
  ProductFiltersResponse,
  ProductSearchResponse,
  ProductSearchResult,
} from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { EmptyState } from '../components/patterns';
import { ExportResultsModal } from '../components/domain/export-results-modal';
import { RecentSearchesDropdown } from '../components/domain/recent-searches-dropdown';
import { SearchFilters } from '../components/domain/search-filters';
import { VectorResultCard } from '../components/domain/vector-result';
import { SearchInput } from '../components/ui/SearchInput';
import { JsonViewer } from '../components/ui/JsonViewer';
import { Button } from '../components/ui/button';
import { useApiClient } from '../hooks/use-api';
import { useDebounce } from '../hooks/use-debounce';
import { useRecentSearches } from '../hooks/use-recent-searches';
import { Modal } from '../components/ui/modal';

const DEFAULT_LIMIT = 20;
const DEFAULT_THRESHOLD = 0.7;

function parseNumber(value: string | null, fallback: number) {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type FilterState = Readonly<{
  vendors: string[];
  productTypes: string[];
  priceMin: number | null;
  priceMax: number | null;
  categoryId: string | null;
  collectionIds: string[];
}>;

const emptyFilters: FilterState = {
  vendors: [],
  productTypes: [],
  priceMin: null,
  priceMax: null,
  categoryId: null,
  collectionIds: [],
};

const emptyFilterOptions: ProductFiltersResponse = {
  vendors: [],
  productTypes: [],
  priceRange: { min: null, max: null },
  categories: [],
  collections: [],
  enrichmentStatus: [],
};

export default function SearchPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useApiClient();
  const recent = useRecentSearches({ storageKey: 'neanelu:web-admin:search:recent:v1' });
  const addRecent = recent.add;

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [limit, setLimit] = useState(
    clampNumber(parseNumber(searchParams.get('limit'), DEFAULT_LIMIT), 1, 100)
  );
  const [threshold, setThreshold] = useState(
    clampNumber(parseNumber(searchParams.get('threshold'), DEFAULT_THRESHOLD), 0.1, 1)
  );
  const [filters, setFilters] = useState<FilterState>(() => ({
    vendors: searchParams.get('vendors')?.split(',').filter(Boolean) ?? [],
    productTypes: searchParams.get('productTypes')?.split(',').filter(Boolean) ?? [],
    priceMin: searchParams.get('priceMin') ? parseNumber(searchParams.get('priceMin'), 0) : null,
    priceMax: searchParams.get('priceMax') ? parseNumber(searchParams.get('priceMax'), 0) : null,
    categoryId: searchParams.get('categoryId'),
    collectionIds: searchParams.get('collectionIds')?.split(',').filter(Boolean) ?? [],
  }));

  const [filtersOptions, setFiltersOptions] = useState<ProductFiltersResponse>(emptyFilterOptions);
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [vectorSearchTimeMs, setVectorSearchTimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [activeJson, setActiveJson] = useState<ProductSearchResult | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Acasă', href: '/' },
      { label: 'Căutare', href: location.pathname },
    ],
    [location.pathname]
  );

  useEffect(() => {
    setTyping(Boolean(query.trim()) && debouncedQuery !== query);
  }, [debouncedQuery, query]);

  useEffect(() => {
    if (!showJson) setActiveJson(null);
  }, [showJson]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (limit !== DEFAULT_LIMIT) next.set('limit', String(limit));
    if (threshold !== DEFAULT_THRESHOLD) next.set('threshold', String(threshold));
    if (filters.vendors.length) next.set('vendors', filters.vendors.join(','));
    if (filters.productTypes.length) next.set('productTypes', filters.productTypes.join(','));
    if (filters.priceMin !== null) next.set('priceMin', String(filters.priceMin));
    if (filters.priceMax !== null) next.set('priceMax', String(filters.priceMax));
    if (filters.categoryId) next.set('categoryId', filters.categoryId);
    if (filters.collectionIds.length) next.set('collectionIds', filters.collectionIds.join(','));
    const nextString = next.toString();
    const currentString = searchParams.toString();
    if (nextString !== currentString) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, limit, query, searchParams, setSearchParams, threshold]);

  const fetchFilters = useCallback(async () => {
    try {
      const data = await api.getApi<ProductFiltersResponse>('/products/filters');
      setFiltersOptions(data);
    } catch {
      setFiltersOptions(emptyFilterOptions);
    }
  }, [api]);

  useEffect(() => {
    void fetchFilters();
  }, [fetchFilters]);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setResults([]);
        setVectorSearchTimeMs(null);
        setTotalCount(0);
        return;
      }

      const params = new URLSearchParams();
      params.set('q', trimmed);
      params.set('limit', String(limit));
      params.set('threshold', String(threshold));
      if (filters.vendors.length) params.set('vendors', filters.vendors.join(','));
      if (filters.productTypes.length) params.set('productTypes', filters.productTypes.join(','));
      if (filters.priceMin !== null) params.set('priceMin', String(filters.priceMin));
      if (filters.priceMax !== null) params.set('priceMax', String(filters.priceMax));
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.collectionIds.length)
        params.set('collectionIds', filters.collectionIds.join(','));

      setLoading(true);
      setError(null);

      try {
        const response = await api.getApi<ProductSearchResponse>(
          `/products/search?${params.toString()}`
        );
        setResults(response.results);
        setVectorSearchTimeMs(response.vectorSearchTimeMs);
        setTotalCount(response.totalCount);
        addRecent(trimmed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Căutarea a eșuat');
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    },
    [api, filters, limit, addRecent, threshold]
  );

  useEffect(() => {
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  const resultsHeader = useMemo(() => {
    if (!results.length) return null;
    const timeLabel = vectorSearchTimeMs ? ` (${vectorSearchTimeMs} ms)` : '';
    return `${results.length} rezultate${timeLabel}`;
  }, [results.length, vectorSearchTimeMs]);

  const onExecute = () => {
    void runSearch(query);
  };

  const onSelectRecent = (value: string) => {
    setQuery(value);
    setRecentOpen(false);
    void runSearch(value);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Breadcrumbs items={breadcrumbs} />
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100 motion-safe:animate-[fadeSlideUp_0.5s_ease-out_both]">
            Căutare produse
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Căutare semantica (AI) în catalogul de produse. Ajustează filtrele și pragul pentru
            rezultate relevante.
          </p>
        </div>
        {results.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Button
              variant="secondary"
              onClick={() => setExportOpen(true)}
              className="shrink-0 transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
            >
              Exportă
            </Button>
            <InfoTooltip title="Exportă rezultate" side="bottom">
              Exportă rezultatele căutării curente în CSV sau Excel. Poți alege formatul și
              limitele. Exportul rulează în fundal; vei primi link de descărcare când e gata.
            </InfoTooltip>
          </span>
        ) : null}
      </header>

      <Button
        variant="secondary"
        className="lg:hidden mb-2 inline-flex items-center gap-2"
        onClick={() => setMobileFiltersOpen(true)}
      >
        <Filter className="size-4" />
        Filtre
      </Button>

      {mobileFiltersOpen ? (
        <div
          className="fixed inset-0 z-[900] bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileFiltersOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <article
          className={`
            overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] dark:border-slate-700/60 dark:bg-slate-900/80
            max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[950] max-lg:w-[340px] max-lg:max-w-[85vw] max-lg:overflow-auto max-lg:shadow-2xl
            max-lg:transition-transform max-lg:duration-300 max-lg:ease-out
            ${mobileFiltersOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}
          `}
          style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}
        >
          <div className="flex items-center justify-between lg:hidden mb-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtre</h2>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(false)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="space-y-4">
            <div
              ref={containerRef}
              onFocusCapture={() => setRecentOpen(true)}
              onBlurCapture={(e) => {
                const next = e.relatedTarget as HTMLElement | null;
                if (next && containerRef.current?.contains(next)) return;
                setRecentOpen(false);
              }}
              className="space-y-2"
            >
              <SearchInput
                value={query}
                onChange={setQuery}
                label="Interogare"
                placeholder="Caută produse..."
                loading={loading}
                debounceMs={0}
                multiline
              />
              {recentOpen && query.trim().length === 0 ? (
                <RecentSearchesDropdown
                  searches={recent.entries}
                  onSelect={onSelectRecent}
                  onClear={recent.clear}
                />
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Prag
                  <InfoTooltip title="Prag similaritate" side="bottom">
                    Minim 0.1–1.0. Rezultatele cu scor sub prag sunt excluse. Prag mai mare =
                    rezultate mai relevante dar mai puține. Ex: 0.9 returnează doar potriviri foarte
                    similare.
                  </InfoTooltip>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 0.1, 1);
                    setThreshold(next);
                  }}
                  className="mt-1 block w-full accent-blue-600 dark:accent-blue-400"
                />
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {threshold.toFixed(2)}
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Limită
                  <InfoTooltip title="Limită rezultate" side="bottom">
                    Numărul maxim de rezultate returnate (1–100). Mai multe rezultate = căutare mai
                    lentă. Pentru exporturi mari, folosește butonul Exportă după căutare.
                  </InfoTooltip>
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 1, 100);
                    setLimit(next);
                  }}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-[var(--shadow-sm)] transition-shadow duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-blue-400/50"
                />
              </label>
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
              <button
                type="button"
                role="switch"
                aria-checked={showJson}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                  showJson ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'
                }`}
                onClick={() => setShowJson(!showJson)}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    showJson ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="flex items-center gap-1.5">
                Afișează metadate JSON la click pe card
                <InfoTooltip title="Afișare metadate" side="bottom">
                  Când e activ, click pe un card afișează JSON-ul complet al rezultatului (id,
                  titlu, scor, similaritate etc.). Util pentru debugging sau pentru a vedea
                  structura datelor returnate de căutarea semantică.
                </InfoTooltip>
              </span>
            </label>

            <Button
              variant="primary"
              className="w-full transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
              onClick={onExecute}
            >
              Caută
            </Button>

            <SearchFilters
              filters={filters}
              options={filtersOptions}
              loading={loading}
              onChange={setFilters}
              onReset={() => setFilters(emptyFilters)}
            />
          </div>
        </article>

        <article
          className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] sm:p-6 dark:border-slate-700/60 dark:bg-slate-900/80"
          style={{ animation: 'fadeSlideUp 0.4s ease-out 0.1s both' }}
        >
          <div className="space-y-4">
            {resultsHeader ? (
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {resultsHeader}
              </p>
            ) : null}

            {typing ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                Se actualizează...
              </div>
            ) : null}

            {loading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={`skeleton-${idx}`}
                    className="h-52 rounded-xl border border-slate-200/80 bg-slate-100/50 dark:border-slate-700/60 dark:bg-slate-800/50"
                    style={{
                      animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) ${idx * 80}ms infinite`,
                    }}
                  />
                ))}
              </div>
            ) : null}

            {!loading && error ? (
              <div className="rounded-xl border border-red-200/90 bg-red-50/80 p-4 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
                <p>{error}</p>
                <Button
                  variant="ghost"
                  className="mt-3 text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30"
                  onClick={() => void runSearch(query)}
                >
                  Reîncearcă
                </Button>
              </div>
            ) : null}

            {!loading && !typing && results.length === 0 && query.trim().length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nicio căutare încă"
                description="Introdu o interogare pentru a rula căutarea semantică în catalog."
              />
            ) : null}

            {!loading && !typing && results.length === 0 && query.trim().length > 0 ? (
              <EmptyState
                icon={Search}
                title="Nu am găsit rezultate"
                description="Încearcă să ajustezi filtrele sau să scazi pragul (threshold)."
              />
            ) : null}

            {!loading && results.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((result, idx) => (
                  <VectorResultCard
                    key={result.id}
                    result={result}
                    index={idx}
                    onClick={() => {
                      if (!showJson) return;
                      setActiveJson(result);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      </div>

      <ExportResultsModal
        open={exportOpen}
        results={results}
        totalCount={totalCount}
        onClose={() => setExportOpen(false)}
        onStartAsyncExport={async (format) => {
          const payload = {
            q: query.trim(),
            format,
            limit: 2000,
            threshold,
            vendors: filters.vendors,
            productTypes: filters.productTypes,
            priceMin: filters.priceMin,
            priceMax: filters.priceMax,
            categoryId: filters.categoryId,
            collectionIds: filters.collectionIds,
          };

          const response = await api.postApi<
            { jobId: string; status: 'queued'; estimatedCount: number },
            Record<string, unknown>
          >('/products/search/export', payload);

          return {
            jobId: response.jobId,
            status: response.status,
            progress: 0,
          };
        }}
        onPollAsyncExport={async (jobId) => {
          const status = await api.getApi<{
            jobId: string;
            status: 'queued' | 'processing' | 'completed' | 'failed';
            progress?: number;
            downloadUrl?: string;
            error?: string;
          }>(`/products/search/export/${jobId}`);

          return status;
        }}
      />

      {showJson && activeJson ? (
        <Modal open={Boolean(activeJson)} onClose={() => setActiveJson(null)}>
          <div className="space-y-4 p-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              Metadate rezultat
            </h2>
            <JsonViewer value={activeJson} />
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setActiveJson(null)}
                className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
              >
                Închide
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
