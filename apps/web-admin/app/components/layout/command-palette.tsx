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
      className="fixed inset-0 z-[70] bg-foreground/20 backdrop-blur-sm motion-safe:animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Paletă comenzi"
    >
      <div
        className="mx-auto mt-20 w-full max-w-2xl rounded-xl border border-border/70 bg-card shadow-[var(--shadow-xl)] motion-safe:animate-[scale-in_180ms_ease-out]"
        data-testid="command-palette-container"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            autoFocus
            id="command-palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Caută pagini și acțiuni..."
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            aria-label="Căutare comenzi"
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              filtered[selectedIndex] ? `cmd-item-${filtered[selectedIndex].id}` : undefined
            }
            aria-autocomplete="list"
            role="combobox"
            aria-expanded={filtered.length > 0}
          />
          <kbd className="rounded border border-border/60 bg-subtle/60 px-1.5 py-0.5 text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        <div
          id="command-palette-listbox"
          className="max-h-[360px] overflow-y-auto p-2"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">
              Nu există rezultate pentru căutarea curentă.
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                id={`cmd-item-${item.id}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={
                  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-fast ' +
                  (index === selectedIndex ? 'bg-primary/10 text-foreground' : 'hover:bg-subtle/50')
                }
                onClick={() => navigateToItem(item)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="text-sm font-medium text-foreground">{item.label}</span>
                <span className="text-xs text-muted">{item.description}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
