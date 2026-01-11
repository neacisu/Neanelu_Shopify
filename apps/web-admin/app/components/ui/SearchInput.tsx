import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchSuggestion = Readonly<{
  id: string;
  label: string;
  value: string;
}>;

export type SearchInputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;

  label?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;

  suggestions?: readonly SearchSuggestion[];
  onSelectSuggestion?: (value: string) => void;

  /**
   * Debounce delay for `onChange` calls when typing.
   * Selection actions (enter/click) are immediate.
   */
  debounceMs?: number;

  /**
   * When true, the suggestions menu can open even if the input is empty.
   * Useful for recent searches.
   */
  openOnFocus?: boolean;

  /**
   * Max number of suggestions rendered.
   */
  maxSuggestions?: number;

  className?: string;
}>;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function SearchInput(props: SearchInputProps) {
  const {
    value,
    onChange,
    label = 'Search',
    placeholder,
    disabled,
    loading,
    suggestions = [],
    onSelectSuggestion,
    debounceMs = 200,
    openOnFocus = false,
    maxSuggestions = 20,
    className,
  } = props;

  const inputId = useId();
  const listboxId = useId();

  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const trimmed = draft.trim();

  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    const items = q
      ? suggestions.filter(
          (s) => s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q)
        )
      : suggestions;

    return items.slice(0, maxSuggestions);
  }, [maxSuggestions, suggestions, trimmed]);

  const canOpen = openOnFocus || trimmed.length > 0;
  const shouldShowMenu = open && canOpen && filtered.length > 0;

  const commitChange = useCallback(
    (next: string) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (debounceMs <= 0) {
        onChange(next);
        return;
      }
      debounceRef.current = window.setTimeout(() => {
        onChange(next);
      }, debounceMs);
    },
    [debounceMs, onChange]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const select = useCallback(
    (nextValue: string) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      setDraft(nextValue);
      onChange(nextValue);
      onSelectSuggestion?.(nextValue);
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange, onSelectSuggestion]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        if (!open) setOpen(true);
        if (!canOpen) return;
        e.preventDefault();
        setActiveIndex((idx) => clamp(idx + 1, 0, Math.max(0, filtered.length - 1)));
        return;
      }

      if (e.key === 'ArrowUp') {
        if (!open) setOpen(true);
        if (!canOpen) return;
        e.preventDefault();
        setActiveIndex((idx) => clamp(idx - 1, 0, Math.max(0, filtered.length - 1)));
        return;
      }

      if (e.key === 'Enter') {
        if (shouldShowMenu && activeIndex >= 0 && activeIndex < filtered.length) {
          e.preventDefault();
          select(filtered[activeIndex]?.value ?? draft);
          return;
        }
        return;
      }

      if (e.key === 'Escape') {
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
      }
    },
    [activeIndex, canOpen, draft, filtered, open, select, shouldShowMenu]
  );

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-caption text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          className={
            'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60'
          }
          aria-autocomplete={filtered.length ? 'list' : 'none'}
          aria-controls={listboxId}
          aria-expanded={shouldShowMenu}
          aria-activedescendant={
            shouldShowMenu && activeIndex >= 0 && activeIndex < filtered.length
              ? `${listboxId}-${filtered[activeIndex]?.id ?? activeIndex}`
              : undefined
          }
          onFocus={() => {
            if (canOpen) setOpen(true);
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.dataset?.['searchSuggestion'] === 'true') return;
            setOpen(false);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setOpen(true);
            setActiveIndex(-1);
            setDraft(e.target.value);
            commitChange(e.target.value);
          }}
        />
        {loading ? (
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
            Loading…
          </div>
        ) : null}

        {shouldShowMenu ? (
          <div
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-background shadow"
            role="listbox"
            id={listboxId}
          >
            {filtered.map((s, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-search-suggestion="true"
                  id={`${listboxId}-${s.id}`}
                  role="option"
                  aria-selected={active}
                  className={
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm ' +
                    (active ? 'bg-muted/40' : 'hover:bg-muted/20')
                  }
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(ev) => {
                    // Prevent input blur before we can select.
                    ev.preventDefault();
                  }}
                  onClick={() => select(s.value)}
                >
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
