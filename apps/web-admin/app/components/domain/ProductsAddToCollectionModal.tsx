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
      <div className="space-y-4 p-4 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 rounded-lg">
        <div>
          <div className="text-h3 dark:text-slate-100">Adaugă la colecție</div>
          <p className="text-body text-muted dark:text-slate-400">
            Selectează o colecție pentru produsele alese.
          </p>
        </div>

        <input
          className="h-10 w-full rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
          placeholder="Caută colecții..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-[280px] overflow-auto rounded-md border border-border dark:border-slate-700">
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted dark:text-slate-400">
              Nu s-au găsit colecții.
            </div>
          ) : (
            filtered.map((item) => (
              <label
                key={item.id}
                className="flex items-center justify-between gap-2 border-b dark:border-slate-700/60 px-3 py-2 text-xs last:border-b-0 dark:text-slate-300 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={selectedId === item.id}
                    onChange={() => setSelectedId(item.id)}
                  />
                  <div>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-muted dark:text-slate-400">
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
    </PolarisModal>
  );
}
