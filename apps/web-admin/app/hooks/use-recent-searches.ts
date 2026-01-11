import { useCallback, useEffect, useMemo, useState } from 'react';

export type RecentSearchesOptions = Readonly<{
  storageKey: string;
  maxItems?: number;
}>;

type RecentSearchesState = readonly string[];

function normalize(term: string): string {
  return term.trim();
}

function safeRead(storageKey: string): RecentSearchesState {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map(normalize)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeWrite(storageKey: string, items: RecentSearchesState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function useRecentSearches(options: RecentSearchesOptions) {
  const { storageKey, maxItems = 20 } = options;

  const [items, setItems] = useState<RecentSearchesState>(() => safeRead(storageKey));

  useEffect(() => {
    setItems(safeRead(storageKey));
  }, [storageKey]);

  const add = useCallback(
    (termRaw: string) => {
      const term = normalize(termRaw);
      if (!term) return;

      setItems((prev) => {
        const next = [term, ...prev.filter((x) => x !== term)].slice(0, maxItems);
        safeWrite(storageKey, next);
        return next;
      });
    },
    [maxItems, storageKey]
  );

  const clear = useCallback(() => {
    setItems([]);
    safeWrite(storageKey, []);
  }, [storageKey]);

  const api = useMemo(
    () => ({
      items,
      add,
      clear,
    }),
    [add, clear, items]
  );

  return api;
}
