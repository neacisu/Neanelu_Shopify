import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

export type VirtualizedListProps<TItem> = Readonly<{
  items: readonly TItem[];
  renderItem: (item: TItem, index: number) => ReactNode;

  itemKey?: (item: TItem, index: number) => string | number;

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
  isLoading?: boolean;

  loadMore?: () => void | Promise<void>;
  hasMore?: boolean;
  loadMoreThresholdPx?: number;

  keyboardNavigation?: boolean;
  defaultActiveIndex?: number;
  onActiveIndexChange?: (index: number) => void;

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
  const [scrollProgress, setScrollProgress] = useState(0);

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

  const updateScrollProgress = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      setScrollProgress(0);
      return;
    }
    setScrollProgress(Math.min(1, el.scrollTop / maxScroll));
  }, []);

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
    maybeLoadMore();
  }, [items.length, maybeLoadMore]);

  useEffect(() => {
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

  if (loading) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {loadingState ?? <div className="p-3 text-sm text-muted">Se încarcă…</div>}
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {loadingState ?? <div className="p-3 text-sm text-muted">Se încarcă…</div>}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={className} style={{ height, width, overflow: 'auto' }} aria-label={ariaLabel}>
        {emptyState ?? <div className="p-3 text-sm text-muted">Niciun element.</div>}
      </div>
    );
  }

  const totalSize = virtualizer.getTotalSize();
  const showScrollIndicator = totalSize > (typeof height === 'number' ? height : 0);

  return (
    <div className="relative">
      <div
        ref={parentRef}
        className={className}
        style={{ height, width, overflow: 'auto', scrollBehavior: 'smooth' }}
        aria-label={ariaLabel}
        onScroll={() => {
          maybeLoadMore();
          updateScrollProgress();
        }}
        onKeyDown={onKeyDown}
        role={keyboardNavigation ? 'listbox' : undefined}
      >
        <div
          className={listClassName}
          style={{ height: totalSize, width: '100%', position: 'relative' }}
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
          <div className="p-2 text-sm text-muted">{loadingMoreState ?? 'Se încarcă…'}</div>
        ) : null}
      </div>

      {showScrollIndicator ? (
        <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b bg-slate-200/50 dark:bg-slate-700/50">
          <div
            className="h-full rounded-full bg-blue-400/60 transition-[width] duration-150 dark:bg-blue-500/60"
            style={{ width: `${scrollProgress * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
