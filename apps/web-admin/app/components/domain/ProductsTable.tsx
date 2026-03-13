import type { ProductListItem } from '@app/types';
import { useMemo, useState } from 'react';
import { useReducedMotion } from '../../hooks/use-reduced-motion';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
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
  const reducedMotion = useReducedMotion();
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
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <div className="min-w-[800px]">
        <div
          className="relative grid items-center gap-3 border-b border-border px-3 py-2 text-xs font-semibold text-muted"
          style={{ gridTemplateColumns }}
        >
          <label className="flex cursor-pointer items-center justify-center">
            <Checkbox
              checked={allSelected}
              onChange={(e) => onToggleAll(e.target.checked)}
              aria-label="Selectează toate"
            />
          </label>
          <span className="hidden sm:block">Imagine</span>
          <div className="relative">
            <button
              type="button"
              className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-subtle/50 hover:text-foreground focus-ring-standard"
              onClick={() => handleSort('title')}
              aria-label="Sortează după Titlu"
            >
              Titlu {sortBy === 'title' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
            </button>
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(event) => startResize(2, event.clientX)}
            />
          </div>
          <div className="relative hidden md:block">
            <button
              type="button"
              className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-subtle/50 hover:text-foreground focus-ring-standard"
              onClick={() => handleSort('vendor')}
              aria-label="Sortează după Vânzător"
            >
              Vânzător {sortBy === 'vendor' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
            </button>
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(event) => startResize(3, event.clientX)}
            />
          </div>
          <div className="relative">
            <button
              type="button"
              className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-subtle/50 hover:text-foreground focus-ring-standard"
              onClick={() => handleSort('status')}
              aria-label="Sortează după Status"
            >
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
              Bronze = date minime, Silver = îmbogățite, Golden = complete. Influențează
              vizibilitatea și promovarea.
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
            <button
              type="button"
              className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-subtle/50 hover:text-foreground focus-ring-standard"
              onClick={() => handleSort('sync_status')}
              aria-label="Sortează după Status sync"
            >
              Status sync {sortBy === 'sync_status' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
            </button>
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(event) => startResize(7, event.clientX)}
            />
          </div>
          <div className="relative hidden lg:block">
            <button
              type="button"
              className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-subtle/50 hover:text-foreground focus-ring-standard"
              onClick={() => handleSort('synced_at')}
              aria-label="Sortează după Ultima sync"
            >
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
          className="max-h-[calc(100vh-280px)]"
          listClassName="relative"
          itemClassName="border-b border-border/60 last:border-b-0"
          emptyState={<div className="p-4 text-sm text-muted">Nu s-au găsit produse.</div>}
          renderItem={(item, index) => (
            <div
              data-selected={selectedIds.has(item.id)}
              className="table-row-interactive grid cursor-pointer items-center gap-3 px-3 py-3 text-sm text-foreground transition-all duration-150 data-[selected=true]:border-l-2 data-[selected=true]:border-l-primary data-[selected=true]:bg-primary/5"
              style={{
                gridTemplateColumns,
                ...(reducedMotion
                  ? {}
                  : {
                      animation: `fadeSlideUp 0.3s ease-out ${Math.min((index ?? 0) * 30, 300)}ms both`,
                    }),
              }}
              role="row"
            >
              <label className="flex items-center justify-center">
                <Checkbox checked={selectedIds.has(item.id)} onChange={() => onToggle(item.id)} />
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRowClick(item.id)}
                aria-label={`Vezi imaginea pentru ${item.title}`}
                className="hidden h-12 w-12 overflow-hidden rounded-md border border-border bg-muted/10 p-0 hover:border-accent-border hover:shadow-[var(--shadow-xs)] sm:block"
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
                    Fără imagine
                  </div>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRowClick(item.id)}
                className="max-w-[200px] truncate rounded-md px-1 py-1 text-left font-medium text-foreground hover:bg-primary/5 hover:text-primary h-auto"
              >
                {item.title}
              </Button>
              <span className="hidden truncate text-sm text-muted md:block">
                {item.vendor ?? '-'}
              </span>
              <span className="text-xs uppercase text-muted">{item.status ?? '-'}</span>
              <QualityLevelBadge level={item.qualityLevel} />
              <span className="text-sm text-muted">{item.variantsCount}</span>
              <SyncStatusBadge status={item.syncStatus} lastSyncedAt={item.syncedAt} />
              <span className="hidden text-xs text-muted lg:block">
                {formatRelativeDate(item.syncedAt)}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}
