import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef } from 'react';

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
    loadingState,
    emptyState,
    ariaLabel,
  } = props;

  const parentRef = useRef<HTMLDivElement | null>(null);

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

  if (loading) {
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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ height, width, overflow: 'auto' }}
      aria-label={ariaLabel}
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
            >
              {renderItem(item as TItem, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
