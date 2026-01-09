import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

export type VirtualizedListProps<TItem> = Readonly<{
  items: readonly TItem[];
  renderItem: (item: TItem, index: number) => ReactNode;

  /**
   * Used for stable keys in React + virtualization.
   * Defaults to index.
   */
  itemKey?: (item: TItem, index: number) => string | number;

  /**
   * Estimate (in px) for item height. Use a constant for best performance.
   */
  estimateSize: number | ((index: number) => number);

  /** Number of extra items to render above/below viewport. */
  overscan?: number;

  /** Fixed container size. Required for reliable virtualization. */
  height: number | string;
  width?: number | string;

  className?: string;
  listClassName?: string;
  itemClassName?: string;

  loading?: boolean;
  /** Plan alias: loading indicator (recommended for infinite scroll use-cases). */
  isLoading?: boolean;

  /** Infinite scroll callback. Called when the list is scrolled near the end. */
  loadMore?: () => void | Promise<void>;

  /** Whether more items can be loaded (defaults to true if loadMore is provided). */
  hasMore?: boolean;

  /** Pixel threshold to trigger loadMore near the end. */
  loadMoreThresholdPx?: number;

  /** Optional keyboard navigation (ArrowUp/ArrowDown/Home/End). */
  keyboardNavigation?: boolean;

  /** Initial active index for keyboard navigation. */
  defaultActiveIndex?: number;

  /** Notification when active index changes (keyboard nav / focus). */
  onActiveIndexChange?: (index: number) => void;

  /** Optional footer shown when isLoading is true and items exist. */
  loadingMoreState?: ReactNode;
  loadingState?: ReactNode;
  emptyState?: ReactNode;

  ariaLabel?: string;
}>;

export function VirtualizedList<TItem>(props: VirtualizedListProps<TItem>) {
  const {
    items,
    renderItem,
    itemKey,
    estimateSize,
    overscan = 8,
    height,
    width = '100%',
    className,
    listClassName,
    itemClassName,
    loading = false,
    isLoading = false,
    loadMore,
    hasMore: hasMoreProp,
    loadMoreThresholdPx = 320,
    keyboardNavigation = false,
    defaultActiveIndex = 0,
    onActiveIndexChange,
    loadingMoreState,
    loadingState,
    emptyState,
    ariaLabel,
  } = props;

  const parentRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreTriggeredForLengthRef = useRef<number | null>(null);
  const hasMore = hasMoreProp ?? Boolean(loadMore);

  const [activeIndex, setActiveIndex] = useState<number>(() => defaultActiveIndex);

  const focusRenderedIndex = useCallback((index: number) => {
    const root = parentRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-virtualized-index="${index}"]`);
    el?.focus();
  }, []);

  const getItemKey = useMemo(() => {
    return itemKey ?? ((_: TItem, index: number) => index);
  }, [itemKey]);

  const estimate = useMemo(() => {
    return typeof estimateSize === 'number' ? () => estimateSize : estimateSize;
  }, [estimateSize]);

  const initialRect = useMemo(() => {
    if (typeof height !== 'number') return undefined;

    return {
      height,
      width: typeof width === 'number' ? width : 0,
    };
  }, [height, width]);

  const observeElementRect = useCallback(
    (
      instance: { scrollElement: HTMLDivElement | null },
      cb: (rect: { width: number; height: number }) => void
    ) => {
      const el = instance.scrollElement;
      if (!el) return;

      const fallbackHeight = typeof height === 'number' ? height : 0;
      const fallbackWidth = typeof width === 'number' ? width : 0;

      const emit = () => {
        const rect = el.getBoundingClientRect();
        cb({
          width: rect.width || fallbackWidth,
          height: rect.height || fallbackHeight,
        });
      };

      emit();

      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => emit());
      ro.observe(el);
      return () => ro.disconnect();
    },
    [height, width]
  );

  const observeElementOffset = useCallback(
    (
      instance: { scrollElement: HTMLDivElement | null },
      cb: (offset: number, isScrolling: boolean) => void
    ) => {
      const el = instance.scrollElement;
      if (!el) return;

      cb(el.scrollTop ?? 0, false);

      let resetTimer: number | undefined;
      const onScroll = () => {
        cb(el.scrollTop ?? 0, true);
        if (typeof window !== 'undefined') {
          if (resetTimer) window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => cb(el.scrollTop ?? 0, false), 150);
        }
      };

      el.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        el.removeEventListener('scroll', onScroll);
        if (typeof window !== 'undefined' && resetTimer) window.clearTimeout(resetTimer);
      };
    },
    []
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimate,
    overscan,
    ...(initialRect ? { initialRect } : {}),
    observeElementRect,
    observeElementOffset,
    getItemKey: (index) => getItemKey(items[index] as TItem, index),
  });

  const virtualItems = virtualizer.getVirtualItems();

  const maybeLoadMore = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    if (!loadMore || !hasMore) return;
    if (loading || isLoading) return;
    if (loadMoreInFlightRef.current) return;

    const remainingPx = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remainingPx > loadMoreThresholdPx) return;

    if (loadMoreTriggeredForLengthRef.current === items.length) return;
    loadMoreTriggeredForLengthRef.current = items.length;

    loadMoreInFlightRef.current = true;
    void Promise.resolve(loadMore()).finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [hasMore, isLoading, items.length, loadMore, loadMoreThresholdPx, loading]);

  useEffect(() => {
    // If the list doesn't fill the viewport, try fetching more.
    maybeLoadMore();
  }, [items.length, maybeLoadMore]);

  useEffect(() => {
    // Near-end detection based on what's currently virtualized.
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= Math.max(0, items.length - 1)) {
      maybeLoadMore();
    }
  }, [items.length, maybeLoadMore, virtualItems]);

  const focusIndex = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
      setActiveIndex(clamped);
      onActiveIndexChange?.(clamped);
      virtualizer.scrollToIndex(clamped, { align: 'auto' });
      // Focus after virtualization has had a chance to render the row.
      if (typeof window !== 'undefined') {
        window.setTimeout(() => focusRenderedIndex(clamped), 0);
      }
    },
    [focusRenderedIndex, items.length, onActiveIndexChange, virtualizer]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!keyboardNavigation) return;
      if (!items.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusIndex(activeIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusIndex(activeIndex - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusIndex(0);
          break;
        case 'End':
          e.preventDefault();
          focusIndex(items.length - 1);
          break;
        default:
          break;
      }
    },
    [activeIndex, focusIndex, items.length, keyboardNavigation]
  );

  // Back-compat: `loading` keeps the old behavior (always shows loading state).
  if (loading) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {loadingState ?? <div className="p-3 text-sm text-muted">Loading…</div>}
      </div>
    );
  }

  // New behavior: `isLoading` is treated as initial-load when the list is empty,
  // otherwise it shows a bottom loading indicator.
  if (isLoading && items.length === 0) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {loadingState ?? <div className="p-3 text-sm text-muted">Loading…</div>}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {emptyState ?? <div className="p-3 text-sm text-muted">No items.</div>}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ height, width, overflow: 'auto' }}
      aria-label={ariaLabel}
      onScroll={() => maybeLoadMore()}
      onKeyDown={onKeyDown}
      role={keyboardNavigation ? 'listbox' : undefined}
    >
      <div
        className={listClassName}
        style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
      >
        {virtualItems.map((virtualRow) => {
          const index = virtualRow.index;
          const item = items[index];

          return (
            <div
              key={virtualRow.key}
              className={itemClassName}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              data-virtualized-index={index}
              role={keyboardNavigation ? 'option' : undefined}
              tabIndex={keyboardNavigation && index === activeIndex ? 0 : -1}
              onFocus={() => {
                if (!keyboardNavigation) return;
                setActiveIndex(index);
                onActiveIndexChange?.(index);
              }}
            >
              {renderItem(item as TItem, index)}
            </div>
          );
        })}
      </div>

      {isLoading && items.length > 0 ? (
        <div className="p-2 text-sm text-muted">{loadingMoreState ?? 'Loading…'}</div>
      ) : null}
    </div>
  );
}
