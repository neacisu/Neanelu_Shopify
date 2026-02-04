const providerLabels: Record<string, string> = {
  serper: 'Serper',
  xai: 'xAI',
};

export type SourcePerformanceRow = Readonly<{
  provider: string;
  totalRequests: number;
  totalCost: number;
  avgLatencyMs: number;
  successRate: number;
}>;

export type SourcePerformanceTableProps = Readonly<{
  rows: readonly SourcePerformanceRow[];
}>;

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function SourcePerformanceTable({ rows }: SourcePerformanceTableProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Source performance</div>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-right">Requests</th>
              <th className="px-3 py-2 text-right">Avg latency</th>
              <th className="px-3 py-2 text-right">Success rate</th>
              <th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  No source performance data yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.provider} className="border-t border-muted/20">
                  <td className="px-3 py-2">{providerLabels[row.provider] ?? row.provider}</td>
                  <td className="px-3 py-2 text-right">{row.totalRequests}</td>
                  <td className="px-3 py-2 text-right">{Math.round(row.avgLatencyMs)} ms</td>
                  <td className="px-3 py-2 text-right">{formatPercent(row.successRate)}</td>
                  <td className="px-3 py-2 text-right">{row.totalCost.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
