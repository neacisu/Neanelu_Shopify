import { BarChart } from '../charts/BarChart';

export type CostBreakdownPoint = Readonly<{
  date: string;
  search: number;
  audit: number;
  extraction: number;
  embedding: number;
}>;

export type CostBreakdownChartProps = Readonly<{
  data: readonly CostBreakdownPoint[];
}>;

export function CostBreakdownChart({ data }: CostBreakdownChartProps) {
  const hasData = data.length > 0;
  return (
    <div
      className="rounded-lg border border-muted/20 bg-background p-4"
      role="img"
      aria-label="Grafic costuri zilnice pe categorii: cautare, audit, extractie si embedding."
    >
      <div className="mb-2 text-xs text-muted">Distribuție zilnica costuri</div>
      {hasData ? (
        <BarChart
          data={data}
          xAxisKey="date"
          stacked
          bars={[
            { dataKey: 'search', name: 'Cautare', color: '#3b82f6' },
            { dataKey: 'audit', name: 'AI Audit', color: '#8b5cf6' },
            { dataKey: 'extraction', name: 'Extractie', color: '#22c55e' },
            { dataKey: 'embedding', name: 'Embedding', color: '#f97316' },
          ]}
        />
      ) : (
        <div className="rounded-md border border-dashed border-muted/30 p-4 text-sm text-muted">
          Nu exista date pentru perioada selectata.
        </div>
      )}
    </div>
  );
}
