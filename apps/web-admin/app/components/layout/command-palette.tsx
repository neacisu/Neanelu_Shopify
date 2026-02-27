import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type CommandItem = Readonly<{
  id: string;
  label: string;
  description: string;
  to: string;
}>;

export type CommandPaletteProps = Readonly<{
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
}>;

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter(
        (item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const navigateToItem = useCallback(
    (item: CommandItem) => {
      void navigate(item.to);
      onClose();
    },
    [navigate, onClose]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length
        );
      } else if (event.key === 'Enter') {
        const selected = filtered[selectedIndex];
        if (selected) {
          event.preventDefault();
          navigateToItem(selected);
        }
      }
    },
    [filtered, selectedIndex, navigateToItem]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="mx-auto mt-20 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-xl)] dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <Search className="size-4 text-slate-400 dark:text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Caută pagini și acțiuni..."
            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nu există rezultate pentru căutarea curentă.
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={
                  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800 ' +
                  (index === selectedIndex ? 'bg-slate-100 dark:bg-slate-800' : '')
                }
                onClick={() => navigateToItem(item)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {item.label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {item.description}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
