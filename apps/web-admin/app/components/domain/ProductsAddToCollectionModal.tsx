import { useMemo, useState } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';

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
    <Modal open={open} onClose={onClose}>
      <div className="space-y-4 p-4 bg-card/80 backdrop-blur-sm rounded-lg">
        <div>
          <div className="text-h3">Adaugă la colecție</div>
          <p className="text-body text-muted">Selectează o colecție pentru produsele alese.</p>
        </div>

        <TextField
          label="Caută colecții"
          placeholder="Caută colecții..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-[280px] overflow-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted">Nu s-au găsit colecții.</div>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs last:border-b-0 transition-colors hover:bg-muted/5"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={selectedId === item.id}
                    onChange={() => setSelectedId(item.id)}
                    className="accent-primary"
                  />
                  <div>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-muted">
                      {item.collectionType} • {item.productsCount} produse
                    </div>
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anulare
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedId && void onConfirm(selectedId)}
            disabled={!selectedId}
          >
            Adaugă la colecție
          </Button>
        </div>
      </div>
    </Modal>
  );
}
