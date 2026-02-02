import { useMemo, useState } from 'react';
import { PolarisModal } from '../../../components/polaris/index.js';
import { Button } from '../ui/button';

type CollectionItem = Readonly<{
  id: string;
  title: string;
  collectionType: string;
  productsCount: number;
}>;

type ProductsAddToCollectionModalProps = Readonly<{
  open: boolean;
  collections: CollectionItem[];
  onClose: () => void;
  onConfirm: (collectionId: string) => void | Promise<void>;
}>;

export function ProductsAddToCollectionModal({
  open,
  collections,
  onClose,
  onConfirm,
}: ProductsAddToCollectionModalProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((item) => item.title.toLowerCase().includes(q));
  }, [collections, query]);

  return (
    <PolarisModal open={open} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <div className="text-h3">Add to collection</div>
          <p className="text-body text-muted">Select a collection for the chosen products.</p>
        </div>

        <input
          className="h-10 rounded-md border bg-background px-3 text-sm"
          placeholder="Search collections..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-[280px] overflow-auto rounded-md border">
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted">No collections found.</div>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={selectedId === item.id}
                    onChange={() => setSelectedId(item.id)}
                  />
                  <div>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-muted">
                      {item.collectionType} • {item.productsCount} products
                    </div>
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedId && void onConfirm(selectedId)}
            disabled={!selectedId}
          >
            Add to collection
          </Button>
        </div>
      </div>
    </PolarisModal>
  );
}
