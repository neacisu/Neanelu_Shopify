import { BarChart } from '../charts/BarChart';

export type ConsensusSourcePoint = Readonly<{
  source: string;
  trustScore: number;
}>;

export type ConsensusSourcesChartProps = Readonly<{
  data: readonly ConsensusSourcePoint[];
}>;

export function ConsensusSourcesChart({ data }: ConsensusSourcesChartProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-md dark:bg-slate-900/80 dark:border-slate-700/60">
      <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">Scor trust pe sursă</div>
      <BarChart
        data={data}
        xAxisKey="source"
        bars={[{ dataKey: 'trustScore', name: 'Scor trust', color: '#22c55e' }]}
      />
    </div>
  );
}
