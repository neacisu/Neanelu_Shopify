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
  onSearch?: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  suggestions?: readonly SuggestionLike[];
  recentSearches?: readonly string[];
  onSelectSuggestion?: (value: string) => void;
  debounceMs?: number;
  multiline?: boolean;
  maxSuggestions?: number;
  className?: string;
}>;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getNextActiveIndex(currentIndex: number, itemCount: number, direction: 1 | -1): number {
  return clamp(currentIndex + direction, 0, Math.max(0, itemCount - 1));
}

function normalizeSuggestions(
  suggestions: readonly SuggestionLike[],
  recentSearches: readonly string[],
  includeRecentSearches: boolean
): SearchSuggestion[] {
  const normalized: SearchSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (typeof suggestion === 'string') {
      normalized.push({ id: suggestion, label: suggestion, value: suggestion });
      continue;
    }

    normalized.push(suggestion);
  }

  if (!includeRecentSearches || recentSearches.length === 0) {
    return normalized;
  }

  const existing = new Set(normalized.map((suggestion) => suggestion.value));
  for (const recentSearch of recentSearches) {
    const trimmedRecent = recentSearch.trim();
    if (trimmedRecent === '' || existing.has(trimmedRecent)) {
      continue;
    }

    normalized.unshift({
      id: `recent:${trimmedRecent}`,
      label: trimmedRecent,
      value: trimmedRecent,
    });
  }

  return normalized;
}

export function SearchInput({
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
}: SearchInputProps) {
  const inputId = useId();
  const suggestionsId = useId();
  const statusId = useId();

  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const trimmed = draft.trim();
  const normalizedSuggestions = useMemo(
    () => normalizeSuggestions(suggestionsProp, recentSearches, trimmed.length === 0),
    [recentSearches, suggestionsProp, trimmed.length]
  );

  const filtered = useMemo(() => {
    const query = trimmed.toLowerCase();
    const items = query
      ? normalizedSuggestions.filter(
          (suggestion) =>
            suggestion.label.toLowerCase().includes(query) ||
            suggestion.value.toLowerCase().includes(query)
        )
      : normalizedSuggestions;

    return items.slice(0, maxSuggestions);
  }, [maxSuggestions, normalizedSuggestions, trimmed]);

  const canOpen = trimmed.length > 0 || recentSearches.length > 0;
  const shouldShowMenu = open && canOpen && filtered.length > 0;

  const statusText = useMemo(() => {
    if (disabled || loading || !canOpen || !open) {
      return loading ? 'Se încarcă sugestii' : '';
    }

    if (filtered.length === 0) {
      return 'Nicio sugestie';
    }

    return `${filtered.length} sugestie${filtered.length === 1 ? '' : 'i'} disponibile`;
  }, [canOpen, disabled, filtered.length, loading, open]);

  const clearPendingSearch = useCallback(() => {
    if (debounceRef.current == null) {
      return;
    }

    globalThis.clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  const focusField = useCallback(() => {
    if (multiline) {
      textareaRef.current?.focus();
      return;
    }

    inputRef.current?.focus();
  }, [multiline]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const commitSearch = useCallback(
    (nextValue: string) => {
      clearPendingSearch();

      if (!onSearch) {
        return;
      }

      if (debounceMs <= 0) {
        onSearch(nextValue);
        return;
      }

      debounceRef.current = globalThis.setTimeout(() => {
        debounceRef.current = null;
        onSearch(nextValue);
      }, debounceMs);
    },
    [clearPendingSearch, debounceMs, onSearch]
  );

  useEffect(
    () => () => {
      clearPendingSearch();
    },
    [clearPendingSearch]
  );

  const selectSuggestion = useCallback(
    (nextValue: string) => {
      clearPendingSearch();
      setDraft(nextValue);
      onChange(nextValue);
      onSearch?.(nextValue);
      onSelectSuggestion?.(nextValue);
      closeMenu();
      focusField();
    },
    [clearPendingSearch, closeMenu, focusField, onChange, onSearch, onSelectSuggestion]
  );

  const clearValue = useCallback(() => {
    clearPendingSearch();
    setDraft('');
    onChange('');
    onSearch?.('');
    closeMenu();
    focusField();
  }, [clearPendingSearch, closeMenu, focusField, onChange, onSearch]);

  const openSuggestions = useCallback(() => {
    if (canOpen) {
      setOpen(true);
    }
  }, [canOpen]);

  const moveActiveSuggestion = useCallback(
    (direction: 1 | -1) => {
      setOpen(true);
      if (!canOpen) {
        return false;
      }

      setActiveIndex((currentIndex) =>
        getNextActiveIndex(currentIndex, filtered.length, direction)
      );
      return true;
    },
    [canOpen, filtered.length]
  );

  const triggerSearchNow = useCallback(
    (nextValue: string) => {
      if (nextValue.length === 0) {
        return false;
      }

      clearPendingSearch();
      onSearch?.(nextValue);
      return true;
    },
    [clearPendingSearch, onSearch]
  );

  const handleEnterKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (multiline && event.shiftKey) {
        return;
      }

      const activeSuggestion =
        shouldShowMenu && activeIndex >= 0 && activeIndex < filtered.length
          ? filtered[activeIndex]
          : undefined;

      if (activeSuggestion) {
        event.preventDefault();
        selectSuggestion(activeSuggestion.value);
        return;
      }

      if (triggerSearchNow(trimmed)) {
        event.preventDefault();
      }
    },
    [activeIndex, filtered, multiline, selectSuggestion, shouldShowMenu, triggerSearchNow, trimmed]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          if (moveActiveSuggestion(1)) {
            event.preventDefault();
          }
          return;
        case 'ArrowUp':
          if (moveActiveSuggestion(-1)) {
            event.preventDefault();
          }
          return;
        case 'Enter':
          handleEnterKey(event);
          return;
        case 'Escape':
          if (open) {
            event.preventDefault();
            closeMenu();
          }
          return;
        default:
          return;
      }
    },
    [closeMenu, handleEnterKey, moveActiveSuggestion, open]
  );

  const commonProps = {
    id: inputId,
    value: draft,
    disabled,
    placeholder,
    className:
      'mt-1.5 w-full rounded-xl border border-border bg-card pl-10 pr-9 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus-visible:border-accent focus-ring-standard disabled:opacity-60',
    'aria-controls': suggestionsId,
    'aria-expanded': shouldShowMenu,
    'aria-busy': loading ? true : undefined,
    'aria-describedby': statusText ? statusId : undefined,
    onFocus: openSuggestions,
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.relatedTarget as HTMLElement | null;
      if (next?.dataset?.['searchSuggestion'] === 'true') {
        return;
      }

      closeMenu();
    },
    onKeyDown,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setOpen(true);
      setActiveIndex(-1);
      setDraft(event.target.value);
      onChange(event.target.value);
      commitSearch(event.target.value);
    },
  };

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 mt-0.75 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />

        {multiline ? (
          <textarea
            ref={textareaRef}
            rows={3}
            {...commonProps}
            className={commonProps.className.replace('pl-10', 'pl-3')}
          />
        ) : (
          <input ref={inputRef} type="search" {...commonProps} />
        )}

        {draft.length > 0 && !loading ? (
          <button
            type="button"
            onClick={clearValue}
            className="absolute right-3 top-1/2 mt-0.75 -translate-y-1/2 rounded-md p-0.5 text-muted transition-all duration-200 hover:bg-subtle hover:text-foreground focus-ring-standard motion-safe:animate-[fadeIn_150ms_ease-out]"
            aria-label="Șterge căutarea"
          >
            <X className="size-3.5" />
          </button>
        ) : null}

        {loading ? (
          <div className="pointer-events-none absolute right-3 top-1/2 mt-0.75 -translate-y-1/2">
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
          <ul
            id={suggestionsId}
            aria-label="Sugestii căutare"
            className="absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-card/80 shadow-lg shadow-black/5 backdrop-blur-xl motion-safe:animate-[fadeSlideUp_0.2s_ease-out]"
          >
            {filtered.map((suggestion, index) => {
              const active = index === activeIndex;
              return (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    data-search-suggestion="true"
                    id={`${suggestionsId}-opt-${index}`}
                    tabIndex={-1}
                    className={
                      'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground transition-colors duration-150 ' +
                      (active ? 'bg-primary/5' : 'hover:bg-subtle')
                    }
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => selectSuggestion(suggestion.value)}
                  >
                    <span className="truncate">{suggestion.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
