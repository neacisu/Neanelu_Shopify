import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useRecentSearches } from '../hooks/use-recent-searches';

describe('useRecentSearches', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists, dedupes, and enforces max items', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const { result } = renderHook(() =>
      useRecentSearches({ storageKey: 'test:recent', maxItems: 3 })
    );

    act(() => {
      result.current.add(' Nike ');
      result.current.add('Adidas');
      result.current.add('Nike');
    });

    const stored = JSON.parse(window.localStorage.getItem('test:recent') ?? '[]') as {
      query: string;
      timestamp: number;
    }[];

    expect(stored.length).toBe(2);
    expect(stored[0]?.query).toBe('Nike');
    expect(stored[1]?.query).toBe('Adidas');
    expect(stored[0]?.timestamp).toBe(1_700_000_000_000);

    act(() => {
      result.current.add('Puma');
      result.current.add('Reebok');
    });

    const stored2 = JSON.parse(window.localStorage.getItem('test:recent') ?? '[]') as {
      query: string;
      timestamp: number;
    }[];

    expect(stored2.length).toBe(3);
    expect(stored2.map((x) => x.query)).toEqual(['Reebok', 'Puma', 'Nike']);

    nowSpy.mockRestore();
  });
});
