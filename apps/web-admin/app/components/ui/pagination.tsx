import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './button';
import { Select } from './select';

export type PaginationProps = Readonly<{
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
  className?: string;
}>;

function joinClasses(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = 'înregistrări',
  className,
}: PaginationProps) {
  return (
    <div
      className={joinClasses(
        'flex flex-col gap-3 border-t border-border/60 px-4 py-4 md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      <div className="text-caption text-muted">
        {total} {itemLabel}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {onPageSizeChange && pageSizeOptions?.length ? (
          <Select
            label="Pe pagină"
            value={String(pageSize ?? pageSizeOptions[0])}
            options={pageSizeOptions.map((value) => ({
              label: String(value),
              value: String(value),
            }))}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="min-w-28"
          />
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            <span className="inline-flex items-center gap-1">
              <ChevronLeft className="size-4" />
              Anterior
            </span>
          </Button>
          <div className="text-caption text-muted">
            Pagina {page + 1} / {Math.max(1, pageCount)}
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            <span className="inline-flex items-center gap-1">
              Următoarea
              <ChevronRight className="size-4" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
