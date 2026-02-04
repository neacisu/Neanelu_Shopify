import { LineChart } from '../charts/LineChart';

export type EnrichmentProgressPoint = Readonly<{
  date: string;
  pending: number;
  completed: number;
}>;

export type EnrichmentProgressChartProps = Readonly<{
  data: readonly EnrichmentProgressPoint[];
}>;

export function EnrichmentProgressChart({ data }: EnrichmentProgressChartProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Enrichment progress</div>
      <LineChart
        data={data}
        xAxisKey="date"
        lines={[
          { dataKey: 'pending', name: 'Pending', color: '#f59e0b', areaFill: true },
          { dataKey: 'completed', name: 'Completed', color: '#22c55e', areaFill: true },
        ]}
      />
    </div>
  );
}
