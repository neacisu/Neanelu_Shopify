import type { ReactNode } from 'react';
import { Loader2, ChevronUp, ChevronDown } from 'lucide-react';

import { Card, CardContent } from './card';
import { Checkbox } from './checkbox';
import { Pagination } from './pagination';

type Align = 'left' | 'center' | 'right';

export type DataTableColumn<Row> = Readonly<{
  id: string;
  header: ReactNode;
  renderCell: (row: Row, index: number) => ReactNode;
  align?: Align;
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
  sortable?: boolean;
  sortKey?: string;
}>;

export type DataTableSortState = Readonly<{
  key: string;
  direction: 'asc' | 'desc';
}>;

export type DataTablePagination = Readonly<{
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
}>;

export type DataTableSelection<Row> = Readonly<{
  selectedRowIds: ReadonlySet<string>;
  isAllSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (rowId: string, row: Row) => void;
  getRowAriaLabel?: (row: Row) => string;
}>;

export type DataTableProps<Row> = Readonly<{
  data: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  sort?: DataTableSortState;
  onSortChange?: (next: DataTableSortState) => void;
  selection?: DataTableSelection<Row>;
  rowActions?: (row: Row) => ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  caption?: ReactNode;
  toolbar?: ReactNode;
  pagination?: DataTablePagination;
  onRowClick?: (row: Row) => void;
  getRowClassName?: (row: Row, index: number) => string;
  className?: string;
  tableClassName?: string;
}>;

function joinClasses(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function getAlignClass(align: Align | undefined, kind: 'header' | 'cell') {
  if (align === 'center') return 'text-center';
  if (align === 'right') return kind === 'header' ? 'text-right' : 'text-right';
  return 'text-left';
}

function renderSortIcon(active: boolean, direction: 'asc' | 'desc' | undefined) {
  if (!active || !direction) return null;
  return direction === 'asc' ? (
    <ChevronUp className="size-3.5" />
  ) : (
    <ChevronDown className="size-3.5" />
  );
}

export function DataTable<Row>({
  data,
  columns,
  rowKey,
  sort,
  onSortChange,
  selection,
  rowActions,
  loading = false,
  skeletonRows = 6,
  emptyState,
  caption,
  toolbar,
  pagination,
  onRowClick,
  getRowClassName,
  className,
  tableClassName,
}: DataTableProps<Row>) {
  const colSpan = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const showEmpty = !loading && data.length === 0;

  return (
    <Card
      variant="bordered"
      padding="none"
      className={joinClasses('relative overflow-x-auto', className)}
    >
      {(toolbar ?? caption) ? (
        <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 md:flex-row md:items-center md:justify-between">
          {toolbar ? <div className="flex-1">{toolbar}</div> : <div />}
          {caption ? <div className="text-caption text-muted">{caption}</div> : null}
        </div>
      ) : null}

      <CardContent className="gap-0">
        <div className="overflow-x-auto">
          <table className={joinClasses('min-w-full border-collapse text-sm', tableClassName)}>
            <thead className="bg-subtle/70 text-caption text-muted">
              <tr>
                {selection ? (
                  <th className="w-12 px-4 py-3 text-left">
                    <Checkbox
                      checked={selection.isAllSelected}
                      aria-label="Selectează toate rândurile"
                      onChange={() => selection.onToggleAll()}
                    />
                  </th>
                ) : null}
                {columns.map((column) => {
                  const isSorted = sort?.key === (column.sortKey ?? column.id);
                  return (
                    <th
                      key={column.id}
                      className={joinClasses(
                        'px-4 py-3 font-semibold',
                        getAlignClass(column.align, 'header'),
                        column.headerClassName
                      )}
                      style={column.width ? { width: column.width } : undefined}
                    >
                      {column.sortable && onSortChange ? (
                        <button
                          type="button"
                          aria-label={`Sortează după ${typeof column.header === 'string' ? column.header : column.id}`}
                          className={joinClasses(
                            'inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors duration-fast hover:bg-background hover:text-foreground',
                            getAlignClass(column.align, 'header')
                          )}
                          onClick={() =>
                            onSortChange({
                              key: column.sortKey ?? column.id,
                              direction: isSorted && sort?.direction === 'asc' ? 'desc' : 'asc',
                            })
                          }
                        >
                          <span>{column.header}</span>
                          {renderSortIcon(isSorted, sort?.direction)}
                        </button>
                      ) : (
                        <span>{column.header}</span>
                      )}
                    </th>
                  );
                })}
                {rowActions ? (
                  <th className="w-12 px-4 py-3 text-left" aria-label="Acțiuni" />
                ) : null}
              </tr>
            </thead>

            <tbody>
              {loading
                ? Array.from({ length: skeletonRows }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="border-t border-border/50">
                      <td colSpan={colSpan} className="px-4 py-4">
                        <div className="h-10 w-full rounded-xl bg-subtle animate-[shimmer-loading_1.5s_ease-in-out_infinite]" />
                      </td>
                    </tr>
                  ))
                : null}

              {showEmpty ? (
                <tr className="border-t border-border/50">
                  <td colSpan={colSpan} className="px-4 py-8 text-center">
                    {emptyState ?? <span className="text-caption text-muted">Nu există date.</span>}
                  </td>
                </tr>
              ) : null}

              {!loading &&
                !showEmpty &&
                data.map((row, index) => {
                  const id = rowKey(row);
                  const isSelected = selection?.selectedRowIds.has(id) ?? false;
                  return (
                    <tr
                      key={id}
                      data-selected={isSelected}
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-selected={selection ? isSelected : undefined}
                      className={joinClasses(
                        'table-row-interactive border-t border-border/50',
                        onRowClick && 'cursor-pointer',
                        isSelected && 'bg-primary/5',
                        getRowClassName?.(row, index)
                      )}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                    >
                      {selection ? (
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={isSelected}
                            aria-label={selection.getRowAriaLabel?.(row) ?? 'Selectează rândul'}
                            onChange={() => selection.onToggleRow(id, row)}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={joinClasses(
                            'px-4 py-3 align-middle text-foreground',
                            getAlignClass(column.align, 'cell'),
                            column.cellClassName
                          )}
                        >
                          {column.renderCell(row, index)}
                        </td>
                      ))}
                      {rowActions ? (
                        <td className="px-4 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {rowActions(row)}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {pagination ? <Pagination {...pagination} /> : null}
      </CardContent>

      {loading ? (
        <div className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-2 rounded-full bg-card/90 px-3 py-1 text-caption text-muted shadow-[var(--shadow-sm)]">
          <Loader2 className="size-3.5 animate-spin" />
          Se încarcă
        </div>
      ) : null}
    </Card>
  );
}
