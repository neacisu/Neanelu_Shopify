import { useMemo } from 'react';

import type { ProductFiltersResponse } from '@app/types';

import { MultiSelect } from '../ui/MultiSelect';
import { TreeView, type TreeNode } from '../ui/TreeView';
import { Button } from '../ui/button';

type FilterState = Readonly<{
  vendors: string[];
  productTypes: string[];
  priceMin: number | null;
  priceMax: number | null;
  categoryId: string | null;
}>;

type SearchFiltersProps = Readonly<{
  filters: FilterState;
  options: ProductFiltersResponse;
  loading?: boolean;
  onChange: (filters: FilterState) => void;
  onReset: () => void;
}>;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toTree(nodes: ProductFiltersResponse['categories']): TreeNode[] {
  return nodes.map((node) => {
    const children = node.children?.length ? toTree(node.children) : undefined;
    return children
      ? { id: node.id, label: node.name, children }
      : { id: node.id, label: node.name };
  });
}

export function SearchFilters({
  filters,
  options,
  loading,
  onChange,
  onReset,
}: SearchFiltersProps) {
  const vendorOptions = useMemo(
    () => options.vendors.map((v) => ({ value: v, label: v })),
    [options.vendors]
  );

  const productTypeOptions = useMemo(
    () => options.productTypes.map((v) => ({ value: v, label: v })),
    [options.productTypes]
  );

  const categoryTree = useMemo(() => toTree(options.categories), [options.categories]);

  const minRange = options.priceRange.min ?? 0;
  const maxRange = options.priceRange.max ?? 0;

  const priceMin = filters.priceMin ?? minRange;
  const priceMax = filters.priceMax ?? maxRange;

  const hasPriceRange =
    Number.isFinite(minRange) && Number.isFinite(maxRange) && maxRange > minRange;

  const counts = {
    vendors: filters.vendors.length,
    productTypes: filters.productTypes.length,
    price: filters.priceMin !== null || filters.priceMax !== null ? 1 : 0,
    category: filters.categoryId ? 1 : 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Advanced filters</div>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={loading}>
          Reset all
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted">
          Vendors {counts.vendors ? `(${counts.vendors})` : ''}
        </div>
        <MultiSelect
          label="Vendors"
          placeholder="Select vendors"
          options={vendorOptions}
          value={filters.vendors}
          onChange={(next) => onChange({ ...filters, vendors: next })}
          disabled={Boolean(loading)}
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted">
          Product types {counts.productTypes ? `(${counts.productTypes})` : ''}
        </div>
        <MultiSelect
          label="Product types"
          placeholder="Select product types"
          options={productTypeOptions}
          value={filters.productTypes}
          onChange={(next) => onChange({ ...filters, productTypes: next })}
          disabled={Boolean(loading)}
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted">
          Price range {counts.price ? '(1)' : ''}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={priceMin}
            min={minRange}
            max={priceMax}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            onChange={(e) => {
              const nextMin = clamp(Number(e.target.value), minRange, priceMax);
              onChange({ ...filters, priceMin: nextMin });
            }}
            disabled={!hasPriceRange || loading}
          />
          <input
            type="number"
            value={priceMax}
            min={priceMin}
            max={maxRange}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            onChange={(e) => {
              const nextMax = clamp(Number(e.target.value), priceMin, maxRange);
              onChange({ ...filters, priceMax: nextMax });
            }}
            disabled={!hasPriceRange || loading}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="range"
            min={minRange}
            max={maxRange}
            value={priceMin}
            className="w-full"
            onChange={(e) => {
              const nextMin = clamp(Number(e.target.value), minRange, priceMax);
              onChange({ ...filters, priceMin: nextMin });
            }}
            disabled={!hasPriceRange || loading}
          />
          <input
            type="range"
            min={minRange}
            max={maxRange}
            value={priceMax}
            className="w-full"
            onChange={(e) => {
              const nextMax = clamp(Number(e.target.value), priceMin, maxRange);
              onChange({ ...filters, priceMax: nextMax });
            }}
            disabled={!hasPriceRange || loading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted">
          Category {counts.category ? '(1)' : ''}
        </div>
        <div className="rounded-md border bg-background p-2">
          <TreeView
            nodes={categoryTree}
            selectedId={filters.categoryId ?? null}
            onSelect={(id) => onChange({ ...filters, categoryId: id })}
            ariaLabel="Category tree"
          />
        </div>
        {filters.categoryId ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...filters, categoryId: null })}
            disabled={loading}
          >
            Clear category
          </Button>
        ) : null}
      </div>
    </div>
  );
}
