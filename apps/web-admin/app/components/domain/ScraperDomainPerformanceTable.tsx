import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { EmptyState } from '../patterns/empty-state';
import { InfoTooltip } from '../ui/info-tooltip';

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
    <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted dark:text-slate-400">Performanță pe domenii</span>
        <InfoTooltip title="Performanță pe domenii" side="bottom" portalToBody>
          Statistici detaliate per domeniu scrapat: pagini totale procesate, rata de succes, latența
          medie și blocările robots.txt. Click pe antetul unei coloane pentru sortare
          ascendentă/descendentă. De exemplu, o rată de succes scăzută poate indica probleme de
          acces sau schimbări de structură. Sfat: monitorizează domeniile cu latență mare.
        </InfoTooltip>
      </div>
      {!rows.length ? (
        <EmptyState
          icon={Globe}
          title="Nicio activitate pe domenii"
          description="Datele vor aparea dupa primele rulari scraper."
        />
      ) : null}
      <div className="overflow-auto rounded-md border dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 dark:bg-slate-800/50">
            <tr>
              <th className="px-3 py-2 text-left dark:text-slate-300">Domeniu</th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => sortBy('totalPages')}
                  className="rounded transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:text-slate-300 dark:focus-visible:ring-blue-400/50"
                >
                  Pagini
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => sortBy('successRate')}
                  className="rounded transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:text-slate-300 dark:focus-visible:ring-blue-400/50"
                >
                  Rata succes
                </button>
              </th>
              <th className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => sortBy('avgLatencyMs')}
                  className="rounded transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:text-slate-300 dark:focus-visible:ring-blue-400/50"
                >
                  Latență medie
                </button>
              </th>
              <th className="px-3 py-2 text-right dark:text-slate-300">Blocări robots</th>
              <th className="px-3 py-2 text-right dark:text-slate-300">Ultima rulare</th>
            </tr>
          </thead>
          <tbody className="dark:text-slate-200">
            {sortedRows.map((row) => (
              <tr key={row.domain} className="border-t border-muted/20 dark:border-slate-700">
                <td className="px-3 py-2">{row.domain}</td>
                <td className="px-3 py-2 text-right">{row.totalPages}</td>
                <td className="px-3 py-2 text-right">{(row.successRate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">{row.avgLatencyMs.toFixed(0)}ms</td>
                <td className="px-3 py-2 text-right">{row.robotsBlocked}</td>
                <td className="px-3 py-2 text-right">
                  {row.lastScrapedAt ? new Date(row.lastScrapedAt).toLocaleString('ro-RO') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
