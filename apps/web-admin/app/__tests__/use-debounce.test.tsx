import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDebounce } from '../hooks/use-debounce';

describe('useDebounce', () => {
  it('updates value after delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'alpha', delay: 300 },
    });

    expect(result.current).toBe('alpha');

    rerender({ value: 'beta', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('alpha');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('beta');

    vi.useRealTimers();
  });
});
