import { useMemo, useState } from 'react';

import type { ProductFiltersResponse } from '@app/types';

import { InfoTooltip } from '../ui/info-tooltip';
import { MultiSelect } from '../ui/MultiSelect';
import { Button } from '../ui/button';

type FilterState = Readonly<{
  vendors: string[];
  productTypes: string[];
  priceMin: number | null;
  priceMax: number | null;
  categoryId: string | null;
  collectionIds: string[];
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

  const [collectionSearch, setCollectionSearch] = useState('');

  const collectionOptions = useMemo(() => {
    const q = collectionSearch.toLowerCase().trim();
    const filtered = q
      ? (options.collections ?? []).filter((c) => c.title.toLowerCase().includes(q))
      : (options.collections ?? []);
    return filtered.slice(0, 50);
  }, [options.collections, collectionSearch]);

  const selectedCollectionTitles = useMemo(() => {
    if (!filters.collectionIds.length) return [];
    const all = options.collections ?? [];
    return filters.collectionIds
      .map((id) => all.find((c) => c.id === id)?.title)
      .filter(Boolean) as string[];
  }, [filters.collectionIds, options.collections]);

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
    collection: filters.collectionIds.length,
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
          <span>Colecții {counts.collection ? `(${counts.collection})` : ''}</span>
          <InfoTooltip title="Colecții Shopify">
            Filtrează rezultatele la produsele din una sau mai multe colecții Shopify. Poți selecta
            mai multe colecții simultan — rezultatele vor include produse din oricare dintre ele.
          </InfoTooltip>
        </div>
        <div className="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <input
            type="text"
            value={collectionSearch}
            onChange={(e) => setCollectionSearch(e.target.value)}
            placeholder="Caută colecții..."
            className="w-full border-b border-slate-200 bg-transparent px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500"
          />
          <div className="max-h-48 overflow-y-auto p-1">
            {collectionOptions.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                Nicio colecție găsită
              </p>
            ) : (
              collectionOptions.map((c) => {
                const checked = filters.collectionIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      checked
                        ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={Boolean(loading)}
                      onChange={() => {
                        const next = checked
                          ? filters.collectionIds.filter((id) => id !== c.id)
                          : [...filters.collectionIds, c.id];
                        onChange({ ...filters, collectionIds: next });
                      }}
                      className="size-3.5 shrink-0 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-500/40 dark:border-slate-600 dark:accent-blue-400"
                    />
                    <span className="min-w-0 truncate">{c.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400 dark:text-slate-500">
                      {c.productsCount}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        {selectedCollectionTitles.length > 0 ? (
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-wrap gap-1">
              {selectedCollectionTitles.map((title) => (
                <span
                  key={title}
                  className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                >
                  {title}
                </span>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => onChange({ ...filters, collectionIds: [] })}
              disabled={loading}
            >
              Curăță
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
