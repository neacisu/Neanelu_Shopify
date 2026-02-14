import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { EmptyState } from '../patterns/empty-state';

export type ScraperDomainPerformanceRow = Readonly<{
  domain: string;
  totalPages: number;
  successRate: number;
  avgLatencyMs: number;
  robotsBlocked: number;
  lastScrapedAt: string | null;
}>;

type SortKey = 'successRate' | 'avgLatencyMs' | 'totalPages';
type SortDirection = 'asc' | 'desc';

export function ScraperDomainPerformanceTable({
  rows,
}: {
  rows: readonly ScraperDomainPerformanceRow[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>('successRate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const left =
        sortKey === 'totalPages'
          ? a.totalPages
          : sortKey === 'avgLatencyMs'
            ? a.avgLatencyMs
            : a.successRate;
      const right =
        sortKey === 'totalPages'
          ? b.totalPages
          : sortKey === 'avgLatencyMs'
            ? b.avgLatencyMs
            : b.successRate;
      const diff = Number(left) - Number(right);
      return sortDirection === 'asc' ? diff : -diff;
    });
  }, [rows, sortDirection, sortKey]);

  function sortBy(key: SortKey): void {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('desc');
  }

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Performanta pe domenii</div>
      {!rows.length ? (
        <EmptyState
          icon={Globe}
          title="Nicio activitate pe domenii"
          description="Datele vor aparea dupa primele rulari scraper."
        />
      ) : null}
      <div className="overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="px-3 py-2 text-left">Domain</th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => sortBy('totalPages')}>
                  Pages
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => sortBy('successRate')}>
                  Success rate
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button type="button" onClick={() => sortBy('avgLatencyMs')}>
                  Avg latency
                </button>
              </th>
              <th className="px-3 py-2 text-right">Robots blocked</th>
              <th className="px-3 py-2 text-right">Last scraped</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.domain} className="border-t border-muted/20">
                <td className="px-3 py-2">{row.domain}</td>
                <td className="px-3 py-2 text-right">{row.totalPages}</td>
                <td className="px-3 py-2 text-right">{(row.successRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">{row.avgLatencyMs.toFixed(0)}ms</td>
                <td className="px-3 py-2 text-right">{row.robotsBlocked}</td>
                <td className="px-3 py-2 text-right">
                  {row.lastScrapedAt ? new Date(row.lastScrapedAt).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
