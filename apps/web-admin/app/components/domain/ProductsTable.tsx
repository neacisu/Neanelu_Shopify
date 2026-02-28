import type { ProductListItem } from '@app/types';
import { useMemo, useState } from 'react';

import { VirtualizedList } from '../ui/VirtualizedList';
import { InfoTooltip } from '../ui/info-tooltip';
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
  const rtf = new Intl.RelativeTimeFormat('ro-RO', { numeric: 'auto' });
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
    <div className="rounded-lg border border-border bg-background dark:border-slate-700 dark:bg-slate-900">
      <div
        className="relative grid items-center gap-3 border-b border-border dark:border-slate-700 px-3 py-2 text-xs font-semibold text-muted dark:text-slate-400 dark:bg-slate-800/50"
        style={{ gridTemplateColumns }}
      >
        <label className="flex cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label="Selectează toate"
          />
        </label>
        <span>Imagine</span>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('title')}>
            Titlu {sortBy === 'title' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(2, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('vendor')}>
            Vânzător {sortBy === 'vendor' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
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
        <div className="relative flex items-center gap-1">
          <span>Calitate</span>
          <InfoTooltip title="Nivel calitate">
            Bronze = date minime, Silver = îmbogățite, Golden = complete. Influențează vizibilitatea
            și promovarea.
          </InfoTooltip>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(5, event.clientX)}
          />
        </div>
        <div className="relative flex items-center gap-1">
          <span>Variante</span>
          <InfoTooltip title="Număr variante">
            Numărul de combinații (mărime, culoare etc.) ale produsului.
          </InfoTooltip>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(6, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('sync_status')}>
            Status sync {sortBy === 'sync_status' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </button>
          <span
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
            onMouseDown={(event) => startResize(7, event.clientX)}
          />
        </div>
        <div className="relative">
          <button type="button" className="text-left" onClick={() => handleSort('synced_at')}>
            Ultima sync {sortBy === 'synced_at' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
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
        itemClassName="border-b last:border-b-0 dark:border-slate-700/60"
        emptyState={
          <div className="p-4 text-sm text-muted dark:text-slate-400">Nu s-au găsit produse.</div>
        }
        renderItem={(item, index) => (
          <div
            className="grid cursor-pointer items-center gap-3 px-3 py-3 text-sm transition-all duration-150 hover:bg-white/80 hover:backdrop-blur-sm dark:hover:bg-slate-800/80 dark:text-slate-200"
            style={{
              gridTemplateColumns,
              animation: `fadeSlideUp 0.3s ease-out ${Math.min((index ?? 0) * 30, 300)}ms both`,
            }}
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
              className="h-12 w-12 overflow-hidden rounded-md border dark:border-slate-700 bg-muted/20 dark:bg-slate-800"
            >
              {item.featuredImageUrl ? (
                <img
                  src={item.featuredImageUrl}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted dark:text-slate-500">
                  Fără imagine
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => onRowClick(item.id)}
              className="text-left font-medium text-foreground dark:text-slate-100 hover:underline"
            >
              {item.title}
            </button>
            <span className="text-sm text-muted dark:text-slate-400">{item.vendor ?? '-'}</span>
            <span className="text-xs uppercase text-muted dark:text-slate-400">
              {item.status ?? '-'}
            </span>
            <QualityLevelBadge level={item.qualityLevel} />
            <span className="text-sm text-muted dark:text-slate-400">{item.variantsCount}</span>
            <SyncStatusBadge status={item.syncStatus} lastSyncedAt={item.syncedAt} />
            <span className="text-xs text-muted dark:text-slate-400">
              {formatRelativeDate(item.syncedAt)}
            </span>
          </div>
        )}
      />
    </div>
  );
}
