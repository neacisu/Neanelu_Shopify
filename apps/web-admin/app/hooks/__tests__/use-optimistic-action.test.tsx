import { renderHook } from '@testing-library/react';
import type { useFetcher } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useOptimisticAction } from '../use-optimistic-action';

// Mock useFetcher
vi.mock('react-router-dom', () => ({
  useFetcher: vi.fn(),
}));

describe('useOptimisticAction', () => {
  it('returns current value when fetcher is idle', () => {
    const mockFetcher = {
      state: 'idle',
      formData: undefined,
    } as unknown as ReturnType<typeof useFetcher>;

    const { result } = renderHook(() => useOptimisticAction('active', 'status', mockFetcher));

    expect(result.current).toBe('active');
  });

  it('returns optimistic value based on formData when submitting', () => {
    const formData = new FormData();
    formData.append('status', 'paused');

    const mockFetcher = {
      state: 'submitting',
      formData: formData,
    } as unknown as ReturnType<typeof useFetcher>;

    const { result } = renderHook(() => useOptimisticAction('active', 'status', mockFetcher));

    expect(result.current).toBe('paused');
  });

  it('transforms optimistic value using provided transformer', () => {
    const formData = new FormData();
    formData.append('count', '5');

    const mockFetcher = {
      state: 'loading',
      formData: formData,
    } as unknown as ReturnType<typeof useFetcher>;

    const { result } = renderHook(() =>
      useOptimisticAction(0, 'count', mockFetcher, (val) => parseInt(val, 10))
    );

    expect(result.current).toBe(5);
  });

  it('rolls back to current value when fetcher returns to idle', () => {
    // 1. Initial State (Idle)
    let mockFetcher = {
      state: 'idle',
      formData: undefined,
    } as unknown as ReturnType<typeof useFetcher>;

    const { result, rerender } = renderHook(
      ({ fetcher }) => useOptimisticAction('original', 'status', fetcher),
      { initialProps: { fetcher: mockFetcher } }
    );
    expect(result.current).toBe('original');

    // 2. Optimization (Submitting)
    const formData = new FormData();
    formData.append('status', 'optimistic');
    mockFetcher = {
      state: 'submitting',
      formData: formData,
    } as unknown as ReturnType<typeof useFetcher>;

    rerender({ fetcher: mockFetcher });
    expect(result.current).toBe('optimistic');

    // 3. Rollback/Completion (Idle again)
    // Even if server value didn't change (e.g. error), it should return passed currentValue
    mockFetcher = {
      state: 'idle',
      formData: undefined, // formData is cleared on idle
    } as unknown as ReturnType<typeof useFetcher>;

    rerender({ fetcher: mockFetcher });
    expect(result.current).toBe('original');
  });
});
