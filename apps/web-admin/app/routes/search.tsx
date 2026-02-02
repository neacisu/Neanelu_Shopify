import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import type {
  ProductFiltersResponse,
  ProductSearchResponse,
  ProductSearchResult,
} from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
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
import { PolarisModal } from '../../components/polaris/index.js';

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
}>;

const emptyFilters: FilterState = {
  vendors: [],
  productTypes: [],
  priceMin: null,
  priceMax: null,
  categoryId: null,
};

const emptyFilterOptions: ProductFiltersResponse = {
  vendors: [],
  productTypes: [],
  priceRange: { min: null, max: null },
  categories: [],
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

  const containerRef = useRef<HTMLDivElement | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Search', href: location.pathname },
    ],
    [location.pathname]
  );

  useEffect(() => {
    const nextTyping = Boolean(query.trim()) && debouncedQuery !== query;
    console.info('[SearchDebug] typing-state', {
      query,
      debouncedQuery,
      nextTyping,
    });
    setTyping(nextTyping);
  }, [debouncedQuery, query]);

  useEffect(() => {
    console.info('[SearchDebug] showJson', { showJson });
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
    const nextString = next.toString();
    const currentString = searchParams.toString();
    console.info('[SearchDebug] sync-url', {
      current: currentString,
      next: nextString,
      query,
      limit,
      threshold,
      filters,
    });
    if (nextString !== currentString) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, limit, query, searchParams, setSearchParams, threshold]);

  const fetchFilters = useCallback(async () => {
    console.info('[SearchDebug] fetch-filters:start');
    try {
      const data = await api.getApi<ProductFiltersResponse>('/products/filters');
      console.info('[SearchDebug] fetch-filters:success', {
        vendors: data.vendors.length,
        productTypes: data.productTypes.length,
        categories: data.categories.length,
      });
      setFiltersOptions(data);
    } catch (err) {
      console.info('[SearchDebug] fetch-filters:error', {
        message: err instanceof Error ? err.message : String(err),
      });
      setFiltersOptions(emptyFilterOptions);
    }
  }, [api]);

  useEffect(() => {
    console.info('[SearchDebug] useEffect:fetchFilters');
    void fetchFilters();
  }, [fetchFilters]);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      console.info('[SearchDebug] runSearch:start', {
        text,
        trimmed,
        limit,
        threshold,
        filters,
      });
      if (!trimmed) {
        console.info('[SearchDebug] runSearch:empty-query');
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

      setLoading(true);
      setError(null);

      try {
        const response = await api.getApi<ProductSearchResponse>(
          `/products/search?${params.toString()}`
        );
        console.info('[SearchDebug] runSearch:success', {
          results: response.results.length,
          totalCount: response.totalCount,
          vectorSearchTimeMs: response.vectorSearchTimeMs,
          cached: response.cached,
        });
        setResults(response.results);
        setVectorSearchTimeMs(response.vectorSearchTimeMs);
        setTotalCount(response.totalCount);
        addRecent(trimmed);
      } catch (err) {
        console.info('[SearchDebug] runSearch:error', {
          message: err instanceof Error ? err.message : String(err),
        });
        setError(err instanceof Error ? err.message : 'Search failed');
        setTotalCount(0);
      } finally {
        setLoading(false);
        console.info('[SearchDebug] runSearch:done');
      }
    },
    [api, filters, limit, addRecent, threshold]
  );

  useEffect(() => {
    console.info('[SearchDebug] useEffect:debouncedQuery', { debouncedQuery });
    void runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  const resultsHeader = useMemo(() => {
    if (!results.length) return null;
    const timeLabel = vectorSearchTimeMs ? `in ${vectorSearchTimeMs}ms` : '';
    return `Found ${results.length} results ${timeLabel}`.trim();
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
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex items-center justify-between">
        <h1 className="text-h2">AI Search Playground</h1>
        {results.length > 0 ? (
          <Button variant="secondary" onClick={() => setExportOpen(true)}>
            Export
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
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
              label="Query"
              placeholder="Search products..."
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

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted">
              Threshold
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
              />
              <div className="text-sm text-foreground">{threshold.toFixed(2)}</div>
            </label>
            <label className="space-y-1 text-xs text-muted">
              Limit
              <input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => {
                  const next = clampNumber(Number(e.target.value), 1, 100);
                  setLimit(next);
                }}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <button
              type="button"
              role="switch"
              aria-checked={showJson}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                showJson ? 'bg-primary' : 'bg-muted/30'
              }`}
              onClick={() => setShowJson(!showJson)}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${
                  showJson ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            Show JSON metadata
          </label>

          <Button variant="secondary" className="w-full" onClick={onExecute}>
            Execută
          </Button>

          <SearchFilters
            filters={filters}
            options={filtersOptions}
            loading={loading}
            onChange={setFilters}
            onReset={() => setFilters(emptyFilters)}
          />
        </div>

        <div className="space-y-3">
          {resultsHeader ? <div className="text-sm text-muted">{resultsHeader}</div> : null}

          {typing ? (
            <div className="rounded-md border bg-muted/10 p-4 text-center text-sm text-muted">
              Typing...
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={`skeleton-${idx}`} className="h-48 rounded-lg border bg-muted/10" />
              ))}
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <div>{error}</div>
              <Button variant="ghost" className="mt-2" onClick={() => void runSearch(query)}>
                Retry
              </Button>
            </div>
          ) : null}

          {!loading && !typing && results.length === 0 && query.trim().length === 0 ? (
            <EmptyState
              icon={Search}
              title="No searches yet"
              description="Enter a query to run semantic search."
            />
          ) : null}

          {!loading && !typing && results.length === 0 && query.trim().length > 0 ? (
            <EmptyState
              icon={Search}
              title="No results found"
              description="Try adjusting your filters or lowering the threshold."
            />
          ) : null}

          {!loading && results.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((result) => (
                <VectorResultCard
                  key={result.id}
                  result={result}
                  onClick={() => {
                    if (!showJson) return;
                    setActiveJson(result);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
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
        <PolarisModal open={Boolean(activeJson)} onClose={() => setActiveJson(null)}>
          <div className="space-y-3 p-4">
            <div className="text-h3">Vector metadata</div>
            <JsonViewer value={activeJson} />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setActiveJson(null)}>
                Close
              </Button>
            </div>
          </div>
        </PolarisModal>
      ) : null}
    </div>
  );
}
