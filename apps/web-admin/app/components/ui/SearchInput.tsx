import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchSuggestion = Readonly<{
  id: string;
  label: string;
  value: string;
}>;

type SuggestionLike = string | SearchSuggestion;

export type SearchInputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;

  /** Triggered for search execution (debounced typing + immediate select/enter). */
  onSearch?: (value: string) => void;

  label?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;

  /** Suggestions list. Can be strings or objects (id/label/value). */
  suggestions?: readonly SuggestionLike[];

  /** Recent searches (shown when input is empty, Polaris Autocomplete-style). */
  recentSearches?: readonly string[];

  /** Back-compat: fired when a suggestion is selected (also triggers onSearch). */
  onSelectSuggestion?: (value: string) => void;

  /** Debounce delay for `onSearch` calls when typing. */
  debounceMs?: number;

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
    onSearch,
    label = 'Search',
    placeholder,
    disabled,
    loading,
    suggestions: suggestionsProp = [],
    recentSearches = [],
    onSelectSuggestion,
    debounceMs = 200,
    maxSuggestions = 20,
    className,
  } = props;

  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();

  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const trimmed = draft.trim();

  const normalizedSuggestions = useMemo((): SearchSuggestion[] => {
    const base: SearchSuggestion[] = [];

    for (const s of suggestionsProp) {
      if (typeof s === 'string') {
        base.push({ id: s, label: s, value: s });
      } else {
        base.push(s);
      }
    }

    // Prepend recent searches when input is empty.
    if (trimmed.length === 0 && recentSearches.length > 0) {
      const existing = new Set(base.map((x) => x.value));
      for (const v of recentSearches) {
        if (!v.trim()) continue;
        if (existing.has(v)) continue;
        base.unshift({ id: `recent:${v}`, label: v, value: v });
      }
    }

    return base;
  }, [recentSearches, suggestionsProp, trimmed.length]);

  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    const items = q
      ? normalizedSuggestions.filter(
          (s) => s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q)
        )
      : normalizedSuggestions;

    return items.slice(0, maxSuggestions);
  }, [maxSuggestions, normalizedSuggestions, trimmed]);

  const canOpen = trimmed.length > 0 || recentSearches.length > 0;
  const shouldShowMenu = open && canOpen && filtered.length > 0;

  const statusText = useMemo(() => {
    if (disabled) return '';
    if (loading) return 'Loading suggestions';
    if (!canOpen) return '';
    if (!open) return '';
    if (filtered.length === 0) return 'No suggestions';
    return `${filtered.length} suggestion${filtered.length === 1 ? '' : 's'} available`;
  }, [canOpen, disabled, filtered.length, loading, open]);

  const commitSearch = useCallback(
    (next: string) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (!onSearch) return;
      if (debounceMs <= 0) {
        onSearch(next);
        return;
      }
      debounceRef.current = window.setTimeout(() => {
        onSearch(next);
      }, debounceMs);
    },
    [debounceMs, onSearch]
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
      onSearch?.(nextValue);
      onSelectSuggestion?.(nextValue);
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange, onSearch, onSelectSuggestion]
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
        if (trimmed.length > 0) {
          e.preventDefault();
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          onSearch?.(trimmed);
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
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete={filtered.length ? 'list' : 'none'}
          aria-controls={listboxId}
          aria-expanded={shouldShowMenu}
          aria-busy={loading ? true : undefined}
          aria-describedby={statusText ? statusId : undefined}
          aria-activedescendant={
            shouldShowMenu && activeIndex >= 0 && activeIndex < filtered.length
              ? `${listboxId}-opt-${activeIndex}`
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
            onChange(e.target.value);
            commitSearch(e.target.value);
          }}
        />
        {loading ? (
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
            Loading…
          </div>
        ) : null}

        {statusText ? (
          <div id={statusId} className="sr-only" aria-live="polite">
            {statusText}
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
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
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
