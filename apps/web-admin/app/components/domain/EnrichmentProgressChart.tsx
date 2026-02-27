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
    <div className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-md dark:bg-slate-900/80 dark:border-slate-700/60">
      <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">Progres enrichment</div>
      <LineChart
        data={data}
        xAxisKey="date"
        lines={[
          { dataKey: 'pending', name: 'În așteptare', color: '#f59e0b', areaFill: true },
          { dataKey: 'completed', name: 'Finalizate', color: '#22c55e', areaFill: true },
        ]}
      />
    </div>
  );
}
