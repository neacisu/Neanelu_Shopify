import { Filter, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { useLocation, useSearchParams } from 'react-router-dom';

import type {
  ProductFiltersResponse,
  ProductSearchResponse,
  ProductSearchResult,
} from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { EmptyState } from '../components/patterns';
import { ErrorState } from '../components/patterns/error-state.js';
import { LoadingState } from '../components/patterns/loading-state.js';
import { ExportResultsModal } from '../components/domain/export-results-modal';
import { RecentSearchesDropdown } from '../components/domain/recent-searches-dropdown';
import { SearchFilters } from '../components/domain/search-filters';
import { VectorResultCard } from '../components/domain/vector-result';
import { SearchInput } from '../components/ui/SearchInput';
import { JsonViewer } from '../components/ui/JsonViewer';
import { Button } from '../components/ui/button';
import { TextField } from '../components/ui/text-field';
import { Slider } from '../components/ui/slider';
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
  const reducedMotion = useReducedMotion();
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
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Căutare produse"
        description="Căutare semantica (AI) în catalogul de produse. Ajustează filtrele și pragul pentru rezultate relevante."
        actions={
          results.length > 0 ? (
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
          ) : undefined
        }
      />

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
          className="fixed inset-0 z-[900] bg-overlay/35 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileFiltersOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <article
          className={`
 overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)]
 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[950] max-lg:w-[340px] max-lg:max-w-[85vw] max-lg:overflow-auto max-lg:shadow-2xl
 max-lg:transition-transform max-lg:duration-300 max-lg:ease-out
 ${mobileFiltersOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}
 `}
          style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.4s ease-out both' }}
        >
          <div className="flex items-center justify-between lg:hidden mb-3">
            <h2 className="text-sm font-semibold text-foreground">Filtre</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileFiltersOpen(false)}
              aria-label="Închide filtre"
            >
              <X className="size-5" />
            </Button>
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
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                  Prag
                  <InfoTooltip title="Prag similaritate" side="bottom">
                    Minim 0.1–1.0. Rezultatele cu scor sub prag sunt excluse. Prag mai mare =
                    rezultate mai relevante dar mai puține. Ex: 0.9 returnează doar potriviri foarte
                    similare.
                  </InfoTooltip>
                </span>
                <Slider
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={threshold}
                  showValue={false}
                  onChange={(next) => {
                    setThreshold(clampNumber(next, 0.1, 1));
                  }}
                />
                <div className="text-sm font-medium text-foreground">{threshold.toFixed(2)}</div>
              </label>
              <label className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                  Limită
                  <InfoTooltip title="Limită rezultate" side="bottom">
                    Numărul maxim de rezultate returnate (1–100). Mai multe rezultate = căutare mai
                    lentă. Pentru exporturi mari, folosește butonul Exportă după căutare.
                  </InfoTooltip>
                </span>
                <TextField
                  type="number"
                  min={1}
                  max={100}
                  value={String(limit)}
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 1, 100);
                    setLimit(next);
                  }}
                />
              </label>
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
              <button
                type="button"
                role="switch"
                aria-checked={showJson}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-shadow duration-200 focus:outline-none focus-ring-standard ${
                  showJson ? 'bg-primary' : 'bg-subtle'
                }`}
                onClick={() => setShowJson(!showJson)}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow transition-transform ${
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
          className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] sm:p-6"
          style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.4s ease-out 0.1s both' }}
        >
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {loading ? 'Se încarcă...' : `${totalCount} rezultate găsite`}
          </p>
          <div className="space-y-4">
            {resultsHeader ? (
              <p className="text-sm font-medium text-muted">{resultsHeader}</p>
            ) : null}

            {typing ? (
              <div className="rounded-xl border border-border bg-subtle py-8 text-center text-sm text-muted">
                Se actualizează...
              </div>
            ) : null}

            {loading ? <LoadingState label="Se caută…" /> : null}

            {!loading && error ? (
              <ErrorState message={error} onRetry={() => void runSearch(query)} />
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
            <h2 className="text-lg font-semibold text-foreground">Metadate rezultat</h2>
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
