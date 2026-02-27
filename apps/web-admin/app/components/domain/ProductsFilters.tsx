import { useMemo } from 'react';

import { InfoTooltip } from '../ui/info-tooltip';
import { MultiSelect } from '../ui/MultiSelect';
import { TreeView, type TreeNode } from '../ui/TreeView';
import { Button } from '../ui/button';

// Local type definitions to avoid ESLint resolution issues with path aliases
type QualityLevel = 'bronze' | 'silver' | 'golden' | 'review_needed';
type SyncStatus = 'synced' | 'pending' | 'error' | 'never';

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

interface ProductFiltersResponse {
  vendors: string[];
  productTypes: string[];
  priceRange: { min: number | null; max: number | null };
  categories: CategoryNode[];
  enrichmentStatus: string[];
}

type ProductsFilterState = Readonly<{
  vendors: string[];
  status: string | null;
  qualityLevels: QualityLevel[];
  syncStatus: SyncStatus | null;
  categoryId: string | null;
  hasGtin: boolean;
  enrichmentStatus: string[];
}>;

type ProductsFiltersProps = Readonly<{
  filters: ProductsFilterState;
  options: ProductFiltersResponse;
  loading?: boolean;
  onChange: (filters: ProductsFilterState) => void;
  onReset: () => void;
}>;

function toTree(nodes: CategoryNode[]): TreeNode[] {
  return nodes.map((node) => {
    const children = node.children?.length ? toTree(node.children) : undefined;
    return children
      ? { id: node.id, label: node.name, children }
      : { id: node.id, label: node.name };
  });
}

const qualityOptions: { id: QualityLevel; label: string }[] = [
  { id: 'bronze', label: 'Bronze' },
  { id: 'silver', label: 'Silver' },
  { id: 'golden', label: 'Golden' },
  { id: 'review_needed', label: 'Review' },
];

const syncOptions: { id: SyncStatus; label: string }[] = [
  { id: 'synced', label: 'Synced' },
  { id: 'pending', label: 'Pending' },
  { id: 'error', label: 'Eroare' },
  { id: 'never', label: 'Never' },
];

const defaultEnrichmentOptions = [
  { id: 'pending', label: 'Pending' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'complete', label: 'Complete' },
];

export function ProductsFilters({
  filters,
  options,
  loading,
  onChange,
  onReset,
}: ProductsFiltersProps) {
  const vendorOptions = useMemo(
    () => options.vendors.map((v) => ({ value: v, label: v })),
    [options.vendors]
  );

  const categoryTree = useMemo(() => toTree(options.categories), [options.categories]);
  const enrichmentOptions = useMemo(() => {
    if (options.enrichmentStatus?.length) {
      return options.enrichmentStatus.map((status) => ({
        id: status,
        label: status.replace(/_/g, ' '),
      }));
    }
    return defaultEnrichmentOptions;
  }, [options.enrichmentStatus]);

  return (
    <div
      className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
      style={{
        animation: 'fadeSlideUp 0.4s ease-out both',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold dark:text-slate-100">Filtre</span>
          <InfoTooltip title="Filtre produse">
            Aplică filtre pentru a restrânge lista de produse după furnizor, status, nivel calitate
            (Bronze/Silver/Golden), status sincronizare, categorie, GTIN sau status enrichment.
          </InfoTooltip>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={loading}>
          Resetează
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Furnizor</span>
          <InfoTooltip title="Furnizor">
            Filtrează produsele după furnizor (brand). Poți selecta mai mulți furnizori.
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
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Status</span>
          <InfoTooltip title="Status produs">
            Status în Shopify: ACTIVE (public), DRAFT (ciornă), ARCHIVED (arhivat).
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['ACTIVE', 'DRAFT', 'ARCHIVED'].map((status) => (
            <label key={status} className="flex items-center gap-2 text-xs dark:text-slate-300">
              <input
                type="radio"
                name="status"
                checked={filters.status === status}
                onChange={() => onChange({ ...filters, status })}
              />
              {status}
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...filters, status: null })}
          >
            Curăță
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Nivel calitate</span>
          <InfoTooltip title="Nivel calitate PIM">
            Bronze: date minime. Silver: date îmbunătățite. Golden: date complete și validate.
            Review: necesită revizuire manuală.
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {qualityOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-xs dark:text-slate-300">
              <input
                type="checkbox"
                checked={filters.qualityLevels.includes(option.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...filters.qualityLevels, option.id]
                    : filters.qualityLevels.filter((id) => id !== option.id);
                  onChange({ ...filters, qualityLevels: next });
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Status sincronizare</span>
          <InfoTooltip title="Status sincronizare">
            Synced: sincronizat cu Shopify. Pending: în așteptare. Error: eroare la sync. Never: nu
            a fost niciodată sincronizat.
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {syncOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-xs dark:text-slate-300">
              <input
                type="radio"
                name="sync-status"
                checked={filters.syncStatus === option.id}
                onChange={() => onChange({ ...filters, syncStatus: option.id })}
              />
              {option.label}
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...filters, syncStatus: null })}
          >
            Curăță
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Categorie</span>
          <InfoTooltip title="Categorie taxonomie">
            Filtrează după categorie din taxonomia PIM. Selectează o categorie din arbore.
          </InfoTooltip>
        </div>
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2">
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

      <label className="flex items-center gap-2 text-xs text-muted dark:text-slate-400">
        <input
          type="checkbox"
          checked={filters.hasGtin}
          onChange={(e) => onChange({ ...filters, hasGtin: e.target.checked })}
        />
        <span className="flex items-center gap-1.5">
          Are GTIN
          <InfoTooltip title="GTIN">
            GTIN (EAN/UPC) este codul de bare al produsului. Filtrează doar produsele care au
            identificator GTIN completat.
          </InfoTooltip>
        </span>
      </label>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted dark:text-slate-400">
          <span>Status enrichment</span>
          <InfoTooltip title="Status îmbogățire">
            Pending: în așteptare. In Progress: în curând procesare. Complete: îmbogățire
            finalizată.
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {enrichmentOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-xs dark:text-slate-300">
              <input
                type="checkbox"
                checked={filters.enrichmentStatus.includes(option.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...filters.enrichmentStatus, option.id]
                    : filters.enrichmentStatus.filter((id) => id !== option.id);
                  onChange({ ...filters, enrichmentStatus: next });
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
