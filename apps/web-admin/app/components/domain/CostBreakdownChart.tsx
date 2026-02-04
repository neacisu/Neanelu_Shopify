import { BarChart } from '../charts/BarChart';

export type CostBreakdownPoint = Readonly<{
  date: string;
  search: number;
  audit: number;
  extraction: number;
}>;

export type CostBreakdownChartProps = Readonly<{
  data: readonly CostBreakdownPoint[];
}>;

export function CostBreakdownChart({ data }: CostBreakdownChartProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Daily cost breakdown</div>
      <BarChart
        data={data}
        xAxisKey="date"
        stacked
        bars={[
          { dataKey: 'search', name: 'Search', color: '#3b82f6' },
          { dataKey: 'audit', name: 'AI Audit', color: '#8b5cf6' },
          { dataKey: 'extraction', name: 'Extraction', color: '#22c55e' },
        ]}
      />
    </div>
  );
}
