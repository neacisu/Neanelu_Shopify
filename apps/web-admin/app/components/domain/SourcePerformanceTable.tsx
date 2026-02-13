import { useMemo, useState } from 'react';

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

type SortKey = 'successRate' | 'trustScore' | 'totalHarvests';
type SortDirection = 'asc' | 'desc';

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getRateClasses(value: number): { text: string; bar: string } {
  if (value >= 90) {
    return { text: 'text-success', bar: 'bg-success' };
  }
  if (value >= 70) {
    return { text: 'text-warning', bar: 'bg-warning' };
  }
  return { text: 'text-danger', bar: 'bg-danger' };
}

export function SourcePerformanceTable({ rows }: SourcePerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('successRate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const left = sortKey === 'totalHarvests' ? a.totalHarvests : a[sortKey];
      const right = sortKey === 'totalHarvests' ? b.totalHarvests : b[sortKey];
      const diff = Number(left) - Number(right);
      return sortDirection === 'asc' ? diff : -diff;
    });
  }, [rows, sortDirection, sortKey]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('desc');
  }

  function sortLabel(key: SortKey): string {
    if (sortKey !== key) {
      return 'Sort desc';
    }
    return sortDirection === 'asc' ? 'Sort asc' : 'Sort desc';
  }

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Source performance</div>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => handleSort('totalHarvests')}
                  aria-label="Sort by harvests"
                >
                  Harvests
                  <span className="text-xs text-muted">
                    {sortKey === 'totalHarvests' ? sortLabel('totalHarvests') : ''}
                  </span>
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => handleSort('successRate')}
                  aria-label="Sort by success rate"
                >
                  Success rate
                  <span className="text-xs text-muted">
                    {sortKey === 'successRate' ? sortLabel('successRate') : ''}
                  </span>
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => handleSort('trustScore')}
                  aria-label="Sort by trust score"
                >
                  Trust
                  <span className="text-xs text-muted">
                    {sortKey === 'trustScore' ? sortLabel('trustScore') : ''}
                  </span>
                </button>
              </th>
              <th className="px-3 py-2 text-right">Status</th>
              <th className="px-3 py-2 text-right">Last harvest</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  No source performance data yet.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const style = getRateClasses(row.successRate);
                return (
                  <tr
                    key={`${row.sourceName}-${row.sourceType}`}
                    className="border-t border-muted/20"
                  >
                    <td className="px-3 py-2">{row.sourceName}</td>
                    <td className="px-3 py-2">{row.sourceType}</td>
                    <td className="px-3 py-2 text-right">
                      {row.successfulHarvests}/{row.totalHarvests}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div
                          className="h-2 w-20 overflow-hidden rounded-full bg-muted/30"
                          aria-hidden="true"
                        >
                          <div
                            className={`h-full ${style.bar}`}
                            style={{ width: `${Math.max(0, Math.min(100, row.successRate))}%` }}
                          />
                        </div>
                        <span className={`w-12 text-right tabular-nums ${style.text}`}>
                          {formatPercent(row.successRate)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.trustScore.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={row.isActive ? 'text-success' : 'text-muted'}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.lastHarvestAt ? new Date(row.lastHarvestAt).toLocaleString() : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
