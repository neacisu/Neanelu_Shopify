import { useMemo } from 'react';

import type { ProductFiltersResponse } from '@app/types';

import { InfoTooltip } from '../ui/info-tooltip';
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
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold dark:text-slate-100">Filtre avansate</span>
          <InfoTooltip title="Filtre căutare">
            Filtrele avansate restrâng rezultatele căutării semantice. Sunt utile pentru a găsi
            rapid un produs dintr-o categorie sau de la un anumit furnizor. De exemplu, selectează
            „Nike" la Furnizori și „încălțăminte" la Tip produs. Sfat: combină 2–3 filtre pentru
            precizie maximă.
          </InfoTooltip>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={loading}>
          Resetează
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span>Furnizori {counts.vendors ? `(${counts.vendors})` : ''}</span>
          <InfoTooltip title="Furnizori">
            Furnizorul (brandul) este sursa produsului din catalogul Shopify. Contează pentru a
            separa rezultatele pe mărci, mai ales în cataloage multi-brand. De exemplu, selectează
            „Adidas" ca să vezi doar produsele acelui brand. Sfat: poți selecta mai mulți furnizori
            simultan.
          </InfoTooltip>
        </div>
        <MultiSelect
          label="Furnizori"
          placeholder="Selectează furnizori"
          options={vendorOptions}
          value={filters.vendors}
          onChange={(next) => onChange({ ...filters, vendors: next })}
          disabled={Boolean(loading)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span>Tipuri produs {counts.productTypes ? `(${counts.productTypes})` : ''}</span>
          <InfoTooltip title="Tip produs">
            Tipul de produs corespunde categoriei Shopify (ex: accesorii, îmbrăcăminte,
            electronice). Ajută la segmentarea căutării pe verticale de produse. De exemplu, alege
            „Încălțăminte" pentru a exclude haine din rezultate. Sfat: combină cu furnizor pentru
            rezultate și mai precise.
          </InfoTooltip>
        </div>
        <MultiSelect
          label="Tipuri produs"
          placeholder="Selectează tipuri"
          options={productTypeOptions}
          value={filters.productTypes}
          onChange={(next) => onChange({ ...filters, productTypes: next })}
          disabled={Boolean(loading)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span>Interval preț {counts.price ? '(1)' : ''}</span>
          <InfoTooltip title="Interval preț">
            Filtrează produsele după preț minim și maxim, în moneda catalogului. Este util când
            cauți produse într-un anumit segment de piață. De exemplu, setează 50–150 RON pentru a
            vedea doar produse mid-range. Sfat: folosește slider-ele pentru ajustare rapidă.
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={priceMin}
            min={minRange}
            max={priceMax}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-blue-400/50"
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
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-blue-400/50"
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
            className="w-full accent-blue-600 dark:accent-blue-400"
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
            className="w-full accent-blue-600 dark:accent-blue-400"
            onChange={(e) => {
              const nextMax = clamp(Number(e.target.value), priceMin, maxRange);
              onChange({ ...filters, priceMax: nextMax });
            }}
            disabled={!hasPriceRange || loading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span>Categorie {counts.category ? '(1)' : ''}</span>
          <InfoTooltip title="Categorie">
            Categoriile provin din taxonomia PIM și organizează produsele ierarhic. Sunt utile
            pentru a filtra pe o ramură specifică (ex: „Electronice &gt; Telefoane"). De exemplu,
            selectează „Accesorii" din arbore pentru a restrânge la acea categorie. Sfat: click pe
            ramura dorită, apoi „Curăță categoria" dacă vrei să revii.
          </InfoTooltip>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
          <TreeView
            nodes={categoryTree}
            selectedId={filters.categoryId ?? null}
            onSelect={(id) => onChange({ ...filters, categoryId: id })}
            ariaLabel="Arbore categorii"
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
            Curăță categoria
          </Button>
        ) : null}
      </div>
    </div>
  );
}
