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
    <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-(--shadow-md)">
      <div className="mb-2 text-xs text-muted">Scor trust pe sursă</div>
      <BarChart
        data={data}
        xAxisKey="source"
        bars={[{ dataKey: 'trustScore', name: 'Scor trust', color: 'rgb(var(--color-success))' }]}
      />
    </div>
  );
}
