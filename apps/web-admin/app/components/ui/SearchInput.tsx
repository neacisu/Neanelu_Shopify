import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

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

  /** Use a multiline textarea instead of input. */
  multiline?: boolean;

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
    multiline = false,
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
    if (loading) return 'Se încarcă sugestii';
    if (!canOpen) return '';
    if (!open) return '';
    if (filtered.length === 0) return 'Nicio sugestie';
    return `${filtered.length} sugestie${filtered.length === 1 ? '' : 'i'} disponibile`;
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
      if (multiline) {
        textareaRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    },
    [multiline, onChange, onSearch, onSelectSuggestion]
  );

  const clearValue = useCallback(() => {
    setDraft('');
    onChange('');
    onSearch?.('');
    setOpen(false);
    setActiveIndex(-1);
    if (multiline) {
      textareaRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [multiline, onChange, onSearch]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
        if (multiline && e.shiftKey) return;
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
    [activeIndex, canOpen, draft, filtered, multiline, open, select, shouldShowMenu]
  );

  const ariaAutocomplete = filtered.length ? 'list' : 'none';
  const ariaHasPopup = 'listbox';
  const commonProps = {
    id: inputId,
    value: draft,
    disabled,
    placeholder,
    className:
      'mt-1.5 w-full rounded-xl border border-border bg-card pl-10 pr-9 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:border-border dark:bg-card dark:text-foreground dark:focus:shadow-[0_0_0_3px_rgba(96,165,250,0.2)] disabled:opacity-60',
    role: 'combobox',
    'aria-controls': listboxId,
    'aria-expanded': shouldShowMenu,
    'aria-busy': loading ? true : undefined,
    'aria-describedby': statusText ? statusId : undefined,
    'aria-activedescendant':
      shouldShowMenu && activeIndex >= 0 && activeIndex < filtered.length
        ? `${listboxId}-opt-${activeIndex}`
        : undefined,
    onFocus: () => {
      if (canOpen) setOpen(true);
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.relatedTarget as HTMLElement | null;
      if (next?.dataset?.['searchSuggestion'] === 'true') return;
      setOpen(false);
      setActiveIndex(-1);
    },
    onKeyDown,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setOpen(true);
      setActiveIndex(-1);
      setDraft(e.target.value);
      onChange(e.target.value);
      commitSearch(e.target.value);
    },
  };

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />

        {multiline ? (
          <textarea
            ref={textareaRef}
            rows={3}
            aria-haspopup={ariaHasPopup}
            aria-autocomplete={ariaAutocomplete}
            {...commonProps}
            className={commonProps.className.replace('pl-10', 'pl-3')}
          />
        ) : (
          <input
            ref={inputRef}
            type="search"
            aria-haspopup={ariaHasPopup}
            aria-autocomplete={ariaAutocomplete}
            {...commonProps}
          />
        )}

        {draft.length > 0 && !loading ? (
          <button
            type="button"
            onClick={clearValue}
            className="absolute right-3 top-1/2 mt-[3px] -translate-y-1/2 rounded-md p-0.5 text-muted transition-all duration-200 hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-safe:animate-[fadeIn_150ms_ease-out] dark:focus-visible:ring-blue-400/50"
            aria-label="Șterge căutarea"
          >
            <X className="size-3.5" />
          </button>
        ) : null}

        {loading ? (
          <div className="pointer-events-none absolute right-3 top-1/2 mt-[3px] -translate-y-1/2">
            <span
              className="inline-block size-4 animate-spin rounded-full border-2 border-muted/40 border-t-muted"
              aria-hidden
            />
          </div>
        ) : null}

        {statusText ? (
          <div id={statusId} className="sr-only" aria-live="polite">
            {statusText}
          </div>
        ) : null}

        {shouldShowMenu ? (
          <div
            className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-white/20 bg-white/80 shadow-lg shadow-black/5 backdrop-blur-xl motion-safe:animate-[fadeSlideUp_0.2s_ease-out] dark:border-white/10 dark:bg-slate-900/80 dark:shadow-black/20"
            role="listbox"
            id={listboxId}
          >
            <div className="max-h-64 overflow-y-auto">
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
                      'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground transition-colors duration-150 ' +
                      (active
                        ? 'bg-blue-50/80 dark:bg-blue-900/30'
                        : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50')
                    }
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                    }}
                    onClick={() => select(s.value)}
                  >
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
