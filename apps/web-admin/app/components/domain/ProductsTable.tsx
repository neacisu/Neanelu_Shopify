import type { ProductListItem } from '@app/types';
import { useMemo, useState } from 'react';

import { VirtualizedList } from '../ui/VirtualizedList';
import { QualityLevelBadge } from './QualityLevelBadge';
import { SyncStatusBadge } from './SyncStatusBadge';

type ProductsTableProps = Readonly<{
  items: ProductListItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (next: boolean) => void;
  onRowClick: (id: string) => void;
  height: number;
  loading?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void | Promise<void>;
  hasMore?: boolean;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (nextSortBy: string, nextSortOrder: 'asc' | 'desc') => void;
}>;

function formatRelativeDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const absMin = Math.abs(diffMin);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absMin < 60) return rtf.format(diffMin, 'minute');
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

export function ProductsTable({
  items,
  selectedIds,
  onToggle,
  onToggleAll,
  onRowClick,
  height,
  loading,
  isLoading,
  onLoadMore,
  hasMore,
  sortBy,
  sortOrder,
  onSortChange,
}: ProductsTableProps) {
  const [columnWidths, setColumnWidths] = useState([40, 64, 260, 160, 100, 140, 120, 140, 140]);

  const handleSort = (key: string) => {
    const nextOrder = sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc';
    onSortChange(key, nextOrder);
  };

  const startResize = (index: number, startX: number) => {
    const startWidth = columnWidths[index] ?? 120;
    const onMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setColumnWidths((prev) =>
        prev.map((width, idx) => (idx === index ? Math.max(80, startWidth + delta) : width))
      );
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const gridTemplateColumns = columnWidths.map((w) => `${w}px`).join(' ');
  const allSelected = useMemo(
    () => items.length > 0 && items.every((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  return (
    <div className="rounded-lg border bg-background">
      <div
        className="relative grid items-center gap-3 border-b px-3 py-2 text-xs font-semibold text-muted"
        style={{ gridTemplateColumns }}
      >
        <label className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
        </label>
        <span>Image</span>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('title')}>
            Title {sortBy === 'title' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(2, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('vendor')}>
            Vendor {sortBy === 'vendor' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(3, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('status')}>
            Status {sortBy === 'status' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(4, event.clientX)}
          />
        </div>
        <div className="relative">
          <span>Quality</span>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(5, event.clientX)}
          />
        </div>
        <div className="relative">
          <span>Variants</span>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(6, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('sync_status')}>
            Sync Status {sortBy === 'sync_status' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(7, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('synced_at')}>
            Last Synced {sortBy === 'synced_at' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(8, event.clientX)}
          />
        </div>
      </div>

      <VirtualizedList
        items={items}
        height={height}
        estimateSize={72}
        overscan={10}
        loading={loading ?? false}
        isLoading={isLoading ?? false}
        {...(onLoadMore ? { loadMore: onLoadMore } : {})}
        hasMore={hasMore ?? false}
        className="max-h-[720px]"
        listClassName="relative"
        itemClassName="border-b last:border-b-0"
        emptyState={<div className="p-4 text-sm text-muted">No products found.</div>}
        renderItem={(item) => (
          <div
            className="grid items-center gap-3 px-3 py-3 text-sm hover:bg-muted/10"
            style={{ gridTemplateColumns }}
            role="row"
          >
            <label className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggle(item.id)}
              />
            </label>
            <button
              type="button"
              onClick={() => onRowClick(item.id)}
              className="h-12 w-12 overflow-hidden rounded-md border bg-muted/20"
            >
              {item.featuredImageUrl ? (
                <img
                  src={item.featuredImageUrl}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">
                  No image
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => onRowClick(item.id)}
              className="text-left font-medium text-foreground hover:underline"
            >
              {item.title}
            </button>
            <span className="text-sm text-muted">{item.vendor ?? '-'}</span>
            <span className="text-xs uppercase text-muted">{item.status ?? '-'}</span>
            <QualityLevelBadge level={item.qualityLevel} />
            <span className="text-sm text-muted">{item.variantsCount}</span>
            <SyncStatusBadge status={item.syncStatus} lastSyncedAt={item.syncedAt} />
            <span className="text-xs text-muted">{formatRelativeDate(item.syncedAt)}</span>
          </div>
        )}
      />
    </div>
  );
}
