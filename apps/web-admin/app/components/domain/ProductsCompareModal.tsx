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
  { key: 'title', label: 'Title' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'status', label: 'Status' },
  { key: 'productType', label: 'Product Type' },
  { key: 'priceRange', label: 'Price Range' },
  { key: 'qualityLevel', label: 'Quality Level' },
  { key: 'qualityScore', label: 'Quality Score' },
  { key: 'taxonomyId', label: 'Taxonomy' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'mpn', label: 'MPN' },
  { key: 'titleMaster', label: 'Title (Master)' },
  { key: 'descriptionShort', label: 'Description (Short)' },
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
      <div className="space-y-4 p-4">
        <div>
          <div className="text-h3">Compare products</div>
          <p className="text-body text-muted">Side-by-side comparison of selected products.</p>
        </div>

        <div className="overflow-auto rounded-md border">
          <div
            className="grid gap-2 border-b bg-muted/10 px-3 py-2 text-xs font-semibold"
            style={{ gridTemplateColumns: `200px repeat(${items.length}, minmax(180px, 1fr))` }}
          >
            <div>Field</div>
            {items.map((item) => (
              <div key={item.id}>{item.title}</div>
            ))}
          </div>
          {fields.map((field) => (
            <div
              key={field.key}
              className="grid gap-2 border-b px-3 py-2 text-xs"
              style={{ gridTemplateColumns: `200px repeat(${items.length}, minmax(180px, 1fr))` }}
            >
              <div className="text-muted">{field.label}</div>
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
