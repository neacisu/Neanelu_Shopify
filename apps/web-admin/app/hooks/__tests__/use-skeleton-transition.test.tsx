import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useSkeletonTransition } from '../useSkeletonTransition';

describe('useSkeletonTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in skeleton phase when loading=true', () => {
    const { result } = renderHook(() => useSkeletonTransition(true));
    expect(result.current.phase).toBe('skeleton');
    expect(result.current.skeletonStyle).toEqual({ opacity: 1 });
    expect(result.current.contentStyle).toEqual({ display: 'none' });
  });

  it('transitions skeleton → fade-out → content when loading becomes false', () => {
    const { result, rerender } = renderHook(({ loading }) => useSkeletonTransition(loading), {
      initialProps: { loading: true },
    });

    expect(result.current.phase).toBe('skeleton');

    rerender({ loading: false });
    expect(result.current.phase).toBe('fade-out');
    expect(result.current.skeletonStyle).toEqual({
      opacity: 0,
      transition: 'opacity 200ms ease-out',
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.phase).toBe('content');
    expect(result.current.contentStyle).toEqual({
      opacity: 1,
      transition: 'opacity 300ms ease-out',
      animationFillMode: 'both',
    });
  });

  it('goes directly to content when prefers-reduced-motion is active', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result, rerender } = renderHook(({ loading }) => useSkeletonTransition(loading), {
      initialProps: { loading: true },
    });

    expect(result.current.phase).toBe('skeleton');

    rerender({ loading: false });
    expect(result.current.phase).toBe('content');

    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('stays in skeleton phase when loading remains true', () => {
    const { result, rerender } = renderHook(({ loading }) => useSkeletonTransition(loading), {
      initialProps: { loading: true },
    });

    rerender({ loading: true });
    expect(result.current.phase).toBe('skeleton');
  });

  it('reaches content phase when initially not loading (after fade-out delay)', () => {
    const { result } = renderHook(() => useSkeletonTransition(false));

    expect(result.current.phase).toBe('fade-out');

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.phase).toBe('content');
  });
});
