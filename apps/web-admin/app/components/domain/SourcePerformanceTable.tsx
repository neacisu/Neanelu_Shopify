import type { DataTableColumn } from '../ui/data-table';
import { DataTable } from '../ui/data-table';

export type SourcePerformanceRow = Readonly<{
  sourceName: string;
  sourceType: string;
  totalHarvests: number;
  successfulHarvests: number;
  pendingHarvests: number;
  failedHarvests: number;
  successRate: number;
  trustScore: number;
  isActive: boolean;
  lastHarvestAt: string | null;
}>;

export type SourcePerformanceTableProps = Readonly<{
  rows: readonly SourcePerformanceRow[];
}>;

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getRateClasses(value: number): { text: string; bar: string } {
  if (value >= 90) return { text: 'text-success', bar: 'bg-success' };
  if (value >= 70) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-error', bar: 'bg-error' };
}

const columns: readonly DataTableColumn<SourcePerformanceRow>[] = [
  {
    id: 'sourceName',
    header: 'Sursă',
    renderCell: (row) => <span className="font-medium">{row.sourceName}</span>,
  },
  {
    id: 'sourceType',
    header: 'Tip',
    renderCell: (row) => <span className="text-muted">{row.sourceType}</span>,
  },
  {
    id: 'totalHarvests',
    header: 'Recoltări',
    sortable: true,
    align: 'right',
    renderCell: (row) => (
      <span className="tabular-nums">
        {row.successfulHarvests}/{row.totalHarvests}
      </span>
    ),
  },
  {
    id: 'successRate',
    header: 'Rata succes',
    sortable: true,
    align: 'right',
    renderCell: (row) => {
      const style = getRateClasses(row.successRate);
      return (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border/60" aria-hidden="true">
            <div
              className={`h-full rounded-full transition-[width] duration-slow ${style.bar}`}
              style={{ width: `${Math.max(0, Math.min(100, row.successRate))}%` }}
            />
          </div>
          <span className={`w-12 text-right tabular-nums text-sm font-medium ${style.text}`}>
            {formatPercent(row.successRate)}
          </span>
        </div>
      );
    },
  },
  {
    id: 'trustScore',
    header: 'Trust',
    sortable: true,
    align: 'right',
    renderCell: (row) => <span className="tabular-nums">{row.trustScore.toFixed(2)}</span>,
  },
  {
    id: 'isActive',
    header: 'Status',
    align: 'right',
    renderCell: (row) => (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
          row.isActive
            ? 'bg-success/15 text-success ring-1 ring-success/20'
            : 'bg-muted/10 text-muted ring-1 ring-border/80'
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${row.isActive ? 'bg-success motion-safe:animate-[status-dot-pulse_2s_ease-in-out_infinite]' : 'bg-muted'}`}
          aria-hidden
        />
        {row.isActive ? 'Activ' : 'Inactiv'}
      </span>
    ),
  },
  {
    id: 'lastHarvestAt',
    header: 'Ultima recoltare',
    align: 'right',
    renderCell: (row) => (
      <span className="text-muted">
        {row.lastHarvestAt ? new Date(row.lastHarvestAt).toLocaleString('ro-RO') : '-'}
      </span>
    ),
  },
];

export function SourcePerformanceTable({ rows }: SourcePerformanceTableProps) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(row) => `${row.sourceName}-${row.sourceType}`}
      caption="Performanță surse"
      emptyState={
        <div className="py-6 text-center text-sm text-muted">
          Nu există date de performanță încă.
        </div>
      }
      className="rounded-lg shadow-[var(--shadow-sm)] transition-[box-shadow,border-color] duration-normal hover:shadow-[var(--shadow-md)]"
    />
  );
}
