import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useCountUp } from '../useCountUp';

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ro-RO formatted string', () => {
    const { result } = renderHook(() => useCountUp(1234, { disabled: true }));
    const formatted = result.current;
    expect(formatted).toMatch(/1[.\s]?234/);
  });

  it('final value matches target after animation completes', () => {
    let target = 0;
    const { result, rerender } = renderHook(() => useCountUp(target, { duration: 800 }));

    expect(result.current).toBe('0');

    target = 100;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe('100');
  });

  it('disabled option returns target immediately without animation', () => {
    const { result } = renderHook(() => useCountUp(500, { disabled: true }));
    expect(result.current).toBe('500');
  });

  it('respects custom format function', () => {
    const format = (n: number) => `$${Math.round(n)}`;
    const { result } = renderHook(() => useCountUp(42, { disabled: true, format }));
    expect(result.current).toBe('$42');
  });

  it('animates progressively from 0 to target', () => {
    let target = 0;
    const { result, rerender } = renderHook(() =>
      useCountUp(target, { duration: 1000, format: (n) => String(Math.round(n)) })
    );

    target = 1000;
    rerender();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    const midValue = parseInt(result.current, 10);
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(1000);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe('1000');
  });
});
