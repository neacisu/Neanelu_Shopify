import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import type {
  ProductDetail,
  ProductFiltersResponse,
  ProductListItem,
  QualityLevel,
  SyncStatus,
} from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/patterns';
import { SearchInput } from '../components/ui/SearchInput';
import { Button } from '../components/ui/button';
import { ProductsCompareModal } from '../components/domain/ProductsCompareModal';
import { ProductsAssignCategoryModal } from '../components/domain/ProductsAssignCategoryModal';
import { ProductsAddToCollectionModal } from '../components/domain/ProductsAddToCollectionModal';
import { ProductsTable } from '../components/domain/ProductsTable';
import { ProductsFilters } from '../components/domain/ProductsFilters';
import { ProductsBulkActions } from '../components/domain/ProductsBulkActions';
import { ProductDetailDrawer } from '../components/domain/ProductDetailDrawer';
import { ProductsExportModal } from '../components/domain/ProductsExportModal';
import { useApiClient } from '../hooks/use-api';
import { useDebounce } from '../hooks/use-debounce';
import { toast } from 'sonner';

const DEFAULT_LIMIT = 50;

type ProductsFilterState = Readonly<{
  vendors: string[];
  status: string | null;
  qualityLevels: QualityLevel[];
  syncStatus: SyncStatus | null;
  categoryId: string | null;
  hasGtin: boolean;
  enrichmentStatus: string[];
}>;

const emptyFilters: ProductsFilterState = {
  vendors: [],
  status: null,
  qualityLevels: [],
  syncStatus: null,
  categoryId: null,
  hasGtin: false,
  enrichmentStatus: [],
};

const emptyFilterOptions: ProductFiltersResponse = {
  vendors: [],
  productTypes: [],
  priceRange: { min: null, max: null },
  categories: [],
  enrichmentStatus: [],
};

export default function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [searchMode, setSearchMode] = useState(
    (searchParams.get('mode') as 'exact' | 'semantic') ?? 'exact'
  );
  const debouncedQuery = useDebounce(query, 300);

  const [filters, setFilters] = useState<ProductsFilterState>(() => ({
    vendors: searchParams.get('vendors')?.split(',').filter(Boolean) ?? [],
    status: searchParams.get('status'),
    qualityLevels:
      (searchParams.get('quality')?.split(',').filter(Boolean) as QualityLevel[]) ?? [],
    syncStatus: (searchParams.get('sync') as SyncStatus) ?? null,
    categoryId: searchParams.get('categoryId'),
    hasGtin: searchParams.get('hasGtin') === 'true',
    enrichmentStatus: searchParams.get('enrichment')?.split(',').filter(Boolean) ?? [],
  }));

  const [options, setOptions] = useState<ProductFiltersResponse>(emptyFilterOptions);
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [semanticCursor, setSemanticCursor] = useState<string | null>(null);
  const [semanticHasMore, setSemanticHasMore] = useState(false);
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') ?? 'updated_at');
  const [sortOrder, setSortOrder] = useState(searchParams.get('sortOrder') ?? 'desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<ProductDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareItems, setCompareItems] = useState<
    {
      id: string;
      title: string;
      vendor: string | null;
      status: string | null;
      productType: string | null;
      featuredImageUrl: string | null;
      priceRange: { min: string; max: string; currency: string } | null;
      qualityLevel: string | null;
      qualityScore: string | null;
      taxonomyId: string | null;
      gtin: string | null;
      mpn: string | null;
      titleMaster: string | null;
      descriptionShort: string | null;
    }[]
  >([]);
  const [assignCategoryOpen, setAssignCategoryOpen] = useState(false);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [collections, setCollections] = useState<
    { id: string; title: string; collectionType: string; productsCount: number }[]
  >([]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Products', href: location.pathname },
    ],
    [location.pathname]
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (searchMode !== 'exact') next.set('mode', searchMode);
    if (filters.vendors.length) next.set('vendors', filters.vendors.join(','));
    if (filters.status) next.set('status', filters.status);
    if (filters.qualityLevels.length) next.set('quality', filters.qualityLevels.join(','));
    if (filters.syncStatus) next.set('sync', filters.syncStatus);
    if (filters.categoryId) next.set('categoryId', filters.categoryId);
    if (filters.hasGtin) next.set('hasGtin', 'true');
    if (filters.enrichmentStatus.length) next.set('enrichment', filters.enrichmentStatus.join(','));
    if (sortBy !== 'updated_at') next.set('sortBy', sortBy);
    if (sortOrder !== 'desc') next.set('sortOrder', sortOrder);

    const nextString = next.toString();
    if (nextString !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, query, searchMode, searchParams, setSearchParams]);

  const fetchFilters = useCallback(async () => {
    try {
      const data = await api.getApi<ProductFiltersResponse>('/products/filters');
      setOptions(data);
    } catch {
      setOptions(emptyFilterOptions);
    }
  }, [api]);

  const fetchProducts = useCallback(
    async (nextPage: number, replace = false) => {
      if (replace) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        if (searchMode === 'semantic' && debouncedQuery.trim()) {
          const params = new URLSearchParams();
          params.set('q', debouncedQuery.trim());
          params.set('limit', '50');
          if (!replace && semanticCursor) {
            params.set('cursor', semanticCursor);
          }
          const response = await api.getApi<{
            results: {
              id: string;
              title: string;
              similarity: number;
              featuredImageUrl?: string | null;
              vendor?: string | null;
              productType?: string | null;
              priceRange?: { min: string; max: string; currency: string } | null;
            }[];
            totalCount: number;
            hasMore?: boolean;
            nextCursor?: string | null;
          }>(`/products/search?${params.toString()}`);

          const mapped = response.results.map((result) => ({
            id: result.id,
            title: result.title,
            vendor: result.vendor ?? null,
            status: null,
            productType: result.productType ?? null,
            featuredImageUrl: result.featuredImageUrl ?? null,
            categoryId: null,
            syncedAt: null,
            updatedAtShopify: null,
            variantsCount: 0,
            syncStatus: null,
            qualityLevel: null,
            qualityScore: null,
          })) satisfies ProductListItem[];

          if (replace) {
            setItems(mapped);
          } else {
            setItems((prev) => [...prev, ...mapped]);
          }
          setTotal(response.totalCount);
          setPage(1);
          setSemanticCursor(response.nextCursor ?? null);
          setSemanticHasMore(Boolean(response.hasMore));
          return;
        }

        const params = new URLSearchParams();
        params.set('page', String(nextPage));
        params.set('limit', String(DEFAULT_LIMIT));
        if (searchMode === 'exact' && debouncedQuery.trim()) {
          params.set('search', debouncedQuery.trim());
        }
        if (filters.status) params.set('status', filters.status);
        if (filters.vendors.length) params.set('vendor', filters.vendors.join(','));
        if (filters.qualityLevels.length)
          params.set('qualityLevel', filters.qualityLevels.join(','));
        if (filters.syncStatus) params.set('syncStatus', filters.syncStatus);
        if (filters.categoryId) params.set('categoryId', filters.categoryId);
        if (filters.hasGtin) params.set('hasGtin', 'true');
        if (filters.enrichmentStatus.length)
          params.set('enrichmentStatus', filters.enrichmentStatus.join(','));
        if (sortBy) params.set('sortBy', sortBy);
        if (sortOrder) params.set('sortOrder', sortOrder);

        const response = await api.getApi<{
          items: ProductListItem[];
          page: number;
          limit: number;
          total: number;
        }>(`/products?${params.toString()}`);

        setItems((prev) => (replace ? response.items : [...prev, ...response.items]));
        setTotal(response.total);
        setPage(response.page);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [api, debouncedQuery, filters, searchMode, sortBy, sortOrder, semanticCursor]
  );

  useEffect(() => {
    void fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    setItems([]);
    setSelectedIds(new Set());
    setPage(1);
    setSemanticCursor(null);
    setSemanticHasMore(false);
    void fetchProducts(1, true);
  }, [fetchProducts]);

  const hasMore = searchMode === 'semantic' ? semanticHasMore : items.length < total;

  const onLoadMore = () => {
    if (loadingMore || loading) return;
    if (!hasMore) return;
    if (searchMode === 'semantic') {
      void fetchProducts(1, false);
      return;
    }
    void fetchProducts(page + 1);
  };

  const onToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 100) {
        next.add(id);
      }
      return next;
    });
  };

  const onToggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(items.slice(0, 100).map((item) => item.id)));
  };

  const onRowClick = async (id: string) => {
    const detail = await api.getApi<ProductDetail>(`/products/${id}?includeVariants=false`);
    setActiveProduct(detail);
    setDrawerOpen(true);
  };

  const onForceSync = async (singleProductId?: string) => {
    const idsToSync = singleProductId ? [singleProductId] : Array.from(selectedIds);
    if (idsToSync.length === 0) {
      toast.error('Select at least one product');
      return;
    }
    await api.postApi('/products/bulk-sync', { productIds: idsToSync });
  };

  const onExport = () => setExportOpen(true);

  const onAssignCategory = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one product');
      return;
    }
    setAssignCategoryOpen(true);
  };

  const onAddToCollection = async () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one product');
      return;
    }
    if (!collections.length) {
      const response = await api.getApi<{
        collections: {
          id: string;
          title: string;
          collectionType: string;
          productsCount: number;
        }[];
      }>('/collections');
      setCollections(response.collections);
    }
    setAddToCollectionOpen(true);
  };

  const onCompare = async () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least 2 products to compare');
      return;
    }
    if (selectedIds.size > 3) {
      toast.error('Compare supports up to 3 products');
      return;
    }
    const response = await api.postApi<{ items: typeof compareItems }, { productIds: string[] }>(
      '/products/bulk-compare',
      { productIds: Array.from(selectedIds) }
    );
    setCompareItems(response.items);
    setCompareOpen(true);
  };

  const onRequestEnrichment = async () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one product');
      return;
    }
    await api.postApi('/products/bulk-request-enrichment', {
      productIds: Array.from(selectedIds),
    });
    toast.success('Enrichment requested');
  };

  const onSemanticSearch = () => {
    if (!query.trim()) return;
    void navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Products"
        description="Manage products, quality levels, and enrichment."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void navigate('/products/import')}>
              Import
            </Button>
            <Button variant="secondary" onClick={onExport}>
              Export
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ProductsFilters
          filters={filters}
          options={options}
          loading={loading}
          onChange={setFilters}
          onReset={() => setFilters(emptyFilters)}
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              label="Search products"
              placeholder="Search products..."
              loading={loading}
            />
            <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="search-mode"
                  checked={searchMode === 'exact'}
                  onChange={() => setSearchMode('exact')}
                />
                Exact
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="search-mode"
                  checked={searchMode === 'semantic'}
                  onChange={() => setSearchMode('semantic')}
                />
                Semantic
              </label>
            </div>
            {searchMode === 'semantic' ? (
              <Button variant="secondary" onClick={onSemanticSearch}>
                Open Semantic Search
              </Button>
            ) : null}
          </div>

          <ProductsBulkActions
            selectedCount={selectedIds.size}
            onForceSync={() => void onForceSync()}
            onExport={onExport}
            onAssignCategory={() => void onAssignCategory()}
            onAddToCollection={() => void onAddToCollection()}
            onCompare={() => void onCompare()}
            onRequestEnrichment={() => void onRequestEnrichment()}
          />

          {items.length === 0 && !loading ? (
            <EmptyState title="No products" description="Try adjusting filters or sync." />
          ) : (
            <ProductsTable
              items={items}
              selectedIds={selectedIds}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onRowClick={(id) => void onRowClick(id)}
              height={640}
              loading={loading}
              isLoading={loadingMore}
              onLoadMore={onLoadMore}
              hasMore={hasMore}
              sortBy={sortBy}
              sortOrder={sortOrder as 'asc' | 'desc'}
              onSortChange={(nextSortBy: string, nextSortOrder: string) => {
                setSortBy(nextSortBy);
                setSortOrder(nextSortOrder);
              }}
            />
          )}
        </div>
      </div>

      <ProductDetailDrawer
        open={drawerOpen}
        product={activeProduct}
        onClose={() => setDrawerOpen(false)}
        onForceSync={() => (activeProduct ? void onForceSync(activeProduct.id) : undefined)}
        onEdit={() => {
          if (activeProduct) void navigate(`/products/${activeProduct.id}/edit`);
        }}
      />

      <ProductsCompareModal
        open={compareOpen}
        items={compareItems}
        onClose={() => setCompareOpen(false)}
      />

      <ProductsAssignCategoryModal
        open={assignCategoryOpen}
        categories={options.categories}
        onClose={() => setAssignCategoryOpen(false)}
        onConfirm={async (categoryId) => {
          await api.postApi('/products/bulk-assign-category', {
            productIds: Array.from(selectedIds),
            categoryId,
          });
          setAssignCategoryOpen(false);
          toast.success('Category assigned');
        }}
      />

      <ProductsAddToCollectionModal
        open={addToCollectionOpen}
        collections={collections}
        onClose={() => setAddToCollectionOpen(false)}
        onConfirm={async (collectionId) => {
          await api.postApi('/products/bulk-add-to-collection', {
            productIds: Array.from(selectedIds),
            collectionId,
          });
          setAddToCollectionOpen(false);
          toast.success('Added to collection');
        }}
      />

      <ProductsExportModal
        open={exportOpen}
        totalCount={total}
        onClose={() => setExportOpen(false)}
        onStartAsyncExport={async (format, options) => {
          const payload = {
            format,
            columns: options.columns,
            includeVariants: options.includeVariants,
            filters: options.applyFilters
              ? {
                  search: query.trim(),
                  status: filters.status,
                  vendor: filters.vendors,
                  qualityLevel: filters.qualityLevels,
                  syncStatus: filters.syncStatus,
                  categoryId: filters.categoryId,
                  hasGtin: filters.hasGtin,
                  enrichmentStatus: filters.enrichmentStatus,
                }
              : {},
          };
          const response = await api.postApi<{ jobId: string; status: string }, typeof payload>(
            '/products/export',
            payload
          );
          return { jobId: response.jobId, status: response.status as 'queued' };
        }}
        onPollAsyncExport={async (jobId) => {
          return api.getApi<{
            jobId: string;
            status: 'queued' | 'processing' | 'completed' | 'failed';
            progress?: number;
            downloadUrl?: string;
            error?: string;
          }>(`/products/export/${jobId}`);
        }}
      />
    </div>
  );
}
