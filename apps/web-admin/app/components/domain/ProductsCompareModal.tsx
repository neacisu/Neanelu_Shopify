import { PolarisModal } from '../../../components/polaris/index.js';

type CompareItem = Readonly<{
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
}>;

type ProductsCompareModalProps = Readonly<{
  open: boolean;
  items: CompareItem[];
  onClose: () => void;
}>;

const fields: { key: keyof CompareItem; label: string }[] = [
  { key: 'title', label: 'Titlu' },
  { key: 'vendor', label: 'Vânzător' },
  { key: 'status', label: 'Status' },
  { key: 'productType', label: 'Tip produs' },
  { key: 'priceRange', label: 'Interval preț' },
  { key: 'qualityLevel', label: 'Nivel calitate' },
  { key: 'qualityScore', label: 'Scor calitate' },
  { key: 'taxonomyId', label: 'Taxonomie' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'mpn', label: 'MPN' },
  { key: 'titleMaster', label: 'Titlu (master)' },
  { key: 'descriptionShort', label: 'Descriere (scurtă)' },
];

function formatValue(value: CompareItem[keyof CompareItem]) {
  if (!value) return '-';
  if (typeof value === 'object' && 'min' in value) {
    return `${value.min} - ${value.max} ${value.currency}`;
  }
  return String(value);
}

export function ProductsCompareModal({ open, items, onClose }: ProductsCompareModalProps) {
  return (
    <PolarisModal open={open} onClose={onClose}>
      <div className="space-y-4 p-4 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 rounded-lg">
        <div>
          <div className="text-h3 dark:text-slate-100">Compară produse</div>
          <p className="text-body text-muted dark:text-slate-400">
            Comparație side-by-side a produselor selectate.
          </p>
        </div>

        <div className="overflow-auto rounded-md border border-border dark:border-slate-700">
          <div
            className="grid gap-2 border-b border-border dark:border-slate-700 bg-muted/10 dark:bg-slate-800/50 px-3 py-2 text-xs font-semibold dark:text-slate-300"
            style={{ gridTemplateColumns: `200px repeat(${items.length}, minmax(180px, 1fr))` }}
          >
            <div>Câmp</div>
            {items.map((item) => (
              <div key={item.id}>{item.title}</div>
            ))}
          </div>
          {fields.map((field) => (
            <div
              key={field.key}
              className="grid gap-2 border-b dark:border-slate-700/60 px-3 py-2 text-xs dark:text-slate-300"
              style={{ gridTemplateColumns: `200px repeat(${items.length}, minmax(180px, 1fr))` }}
            >
              <div className="text-muted dark:text-slate-400">{field.label}</div>
              {items.map((item) => (
                <div key={`${item.id}-${field.key}`}>{formatValue(item[field.key])}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </PolarisModal>
  );
}
