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
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Trust score by source</div>
      <BarChart
        data={data}
        xAxisKey="source"
        bars={[{ dataKey: 'trustScore', name: 'Trust score', color: '#22c55e' }]}
      />
    </div>
  );
}
