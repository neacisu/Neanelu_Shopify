import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type PolarisDataTableColumn = Readonly<{
  key: string;
  header: ReactNode;
  cell?: (row: unknown) => ReactNode;
  sortable?: boolean;
}>;

export type PolarisDataTableProps = ComponentPropsWithoutRef<'div'> & {
  columns?: readonly PolarisDataTableColumn[];
  rows?: readonly unknown[];
  children?: ReactNode;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
};

export function PolarisDataTable({
  columns = [],
  rows = [],
  children,
  className = '',
  sortKey,
  sortDirection,
  onSort,
  ...props
}: PolarisDataTableProps) {
  if (children) {
    return (
      <div
        className={`
          overflow-auto rounded-xl border border-border
          dark:border-slate-700
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`
        overflow-auto rounded-xl border border-border
        dark:border-slate-700
        ${className}
      `}
      role="table"
      aria-label="Tabel de date"
      {...props}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-border bg-slate-50/80 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/80">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted ${
                  col.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''
                }`}
                onClick={() => col.sortable && onSort?.(col.key)}
                aria-sort={
                  sortKey === col.key
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key ? (
                    <span className="text-[10px] motion-safe:animate-[fadeIn_150ms_ease-out]">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/50 transition-colors duration-150 last:border-b-0 hover:bg-slate-50/60 dark:border-slate-700/50 dark:hover:bg-slate-800/40"
            >
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2.5 text-foreground">
                  {col.cell
                    ? col.cell(row)
                    : (() => {
                        const v = (row as Record<string, unknown>)[col.key];
                        if (v == null) return '';
                        if (
                          typeof v === 'string' ||
                          typeof v === 'number' ||
                          typeof v === 'boolean'
                        )
                          return String(v);
                        return '';
                      })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
