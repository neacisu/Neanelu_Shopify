import { useCallback, useEffect, useMemo, useState } from 'react';

export type RecentSearchesOptions = Readonly<{
  storageKey: string;
  maxItems?: number;
}>;

export type RecentSearchEntry = Readonly<{
  query: string;
  timestamp: number;
}>;

type RecentSearchesState = readonly RecentSearchEntry[];

function normalize(term: string): string {
  return term.trim();
}

function toEntry(raw: unknown): RecentSearchEntry | null {
  if (typeof raw === 'string') {
    const normalized = normalize(raw);
    if (!normalized) return null;
    return { query: normalized, timestamp: Date.now() };
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const query = typeof record['query'] === 'string' ? normalize(record['query']) : '';
    const timestamp =
      typeof record['timestamp'] === 'number' && Number.isFinite(record['timestamp'])
        ? record['timestamp']
        : Date.now();
    if (!query) return null;
    return { query, timestamp };
  }
  return null;
}

function safeRead(storageKey: string): RecentSearchesState {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(toEntry).filter((x): x is RecentSearchEntry => Boolean(x));
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
  const { storageKey, maxItems = 10 } = options;

  const [entries, setEntries] = useState<RecentSearchesState>(() => safeRead(storageKey));

  useEffect(() => {
    setEntries(safeRead(storageKey));
  }, [storageKey]);

  const add = useCallback(
    (termRaw: string) => {
      const term = normalize(termRaw);
      if (!term) return;

      setEntries((prev) => {
        const next = [
          { query: term, timestamp: Date.now() },
          ...prev.filter((x) => x.query !== term),
        ].slice(0, maxItems);
        safeWrite(storageKey, next);
        return next;
      });
    },
    [maxItems, storageKey]
  );

  const clear = useCallback(() => {
    setEntries([]);
    safeWrite(storageKey, []);
  }, [storageKey]);

  const api = useMemo(
    () => ({
      items: entries.map((entry) => entry.query),
      entries,
      add,
      clear,
    }),
    [add, clear, entries]
  );

  return api;
}
