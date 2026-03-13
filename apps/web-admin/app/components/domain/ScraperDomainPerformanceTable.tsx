import { useMemo } from 'react';
import { Globe } from 'lucide-react';

import { EmptyState } from '../patterns/empty-state';
import { InfoTooltip } from '../ui/info-tooltip';
import type { DataTableColumn, DataTableSortState } from '../ui/data-table';
import { DataTable } from '../ui/data-table';
import { useState } from 'react';

export type ScraperDomainPerformanceRow = Readonly<{
  domain: string;
  totalPages: number;
  successRate: number;
  avgLatencyMs: number;
  robotsBlocked: number;
  lastScrapedAt: string | null;
}>;

type SortKey = 'successRate' | 'avgLatencyMs' | 'totalPages';

const columns: readonly DataTableColumn<ScraperDomainPerformanceRow>[] = [
  {
    id: 'domain',
    header: 'Domeniu',
    renderCell: (row) => <span className="font-medium">{row.domain}</span>,
  },
  {
    id: 'totalPages',
    header: 'Pagini',
    sortKey: 'totalPages',
    sortable: true,
    align: 'right',
    renderCell: (row) => <span className="tabular-nums">{row.totalPages}</span>,
  },
  {
    id: 'successRate',
    header: 'Rata succes',
    sortKey: 'successRate',
    sortable: true,
    align: 'right',
    renderCell: (row) => (
      <span
        className={
          row.successRate >= 0.9
            ? 'text-success tabular-nums'
            : row.successRate >= 0.7
              ? 'text-warning tabular-nums'
              : 'text-error tabular-nums'
        }
      >
        {(row.successRate * 100).toFixed(1)}%
      </span>
    ),
  },
  {
    id: 'avgLatencyMs',
    header: 'Latență medie',
    sortKey: 'avgLatencyMs',
    sortable: true,
    align: 'right',
    renderCell: (row) => (
      <span
        className={`tabular-nums ${row.avgLatencyMs > 2000 ? 'text-warning' : 'text-foreground'}`}
      >
        {row.avgLatencyMs.toFixed(0)}ms
      </span>
    ),
  },
  {
    id: 'robotsBlocked',
    header: 'Blocări robots',
    align: 'right',
    renderCell: (row) =>
      row.robotsBlocked > 0 ? (
        <span className="text-warning tabular-nums">{row.robotsBlocked}</span>
      ) : (
        <span className="text-muted tabular-nums">{row.robotsBlocked}</span>
      ),
  },
  {
    id: 'lastScrapedAt',
    header: 'Ultima rulare',
    align: 'right',
    renderCell: (row) => (
      <span className="text-muted">
        {row.lastScrapedAt ? new Date(row.lastScrapedAt).toLocaleString('ro-RO') : '-'}
      </span>
    ),
  },
];

export function ScraperDomainPerformanceTable({
  rows,
}: {
  rows: readonly ScraperDomainPerformanceRow[];
}) {
  const [sort, setSort] = useState<DataTableSortState>({ key: 'successRate', direction: 'desc' });

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const key = sort.key as SortKey;
      const diff = Number(a[key]) - Number(b[key]);
      return sort.direction === 'asc' ? diff : -diff;
    });
  }, [rows, sort]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 backdrop-blur-sm shadow-[var(--shadow-sm)] transition-[box-shadow,border-color] duration-normal hover:border-accent-border/70 hover:shadow-[var(--shadow-md)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-primary">Performanță pe domenii</span>
        <InfoTooltip title="Performanță pe domenii" side="bottom" portalToBody>
          Statistici detaliate per domeniu scrapat: pagini totale procesate, rata de succes, latența
          medie și blocările robots.txt. Click pe antetul unei coloane pentru sortare
          ascendentă/descendentă. De exemplu, o rată de succes scăzută poate indica probleme de
          acces sau schimbări de structură. Sfat: monitorizează domeniile cu latență mare.
        </InfoTooltip>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Nicio activitate pe domenii"
          description="Datele vor aparea dupa primele rulari scraper."
        />
      ) : (
        <DataTable
          data={sortedRows}
          columns={columns}
          rowKey={(row) => row.domain}
          sort={sort}
          onSortChange={setSort}
          tableClassName="min-w-[560px]"
          className="rounded-md border border-border"
        />
      )}
    </div>
  );
}
