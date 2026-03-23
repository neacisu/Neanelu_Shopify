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
    <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-(--shadow-md)">
      <div className="mb-2 text-xs text-muted">Progres enrichment</div>
      <LineChart
        data={data}
        xAxisKey="date"
        lines={[
          {
            dataKey: 'pending',
            name: 'În așteptare',
            color: 'rgb(var(--color-warning))',
            areaFill: true,
          },
          {
            dataKey: 'completed',
            name: 'Finalizate',
            color: 'rgb(var(--color-success))',
            areaFill: true,
          },
        ]}
      />
    </div>
  );
}
