import { LineChart } from '../charts/LineChart';

export type QualityTrendPoint = Readonly<{
  date: string;
  bronze: number;
  silver: number;
  golden: number;
}>;

export type QualityTrendChartProps = Readonly<{
  data: readonly QualityTrendPoint[];
}>;

export function QualityTrendChart({ data }: QualityTrendChartProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Quality trend (30 days)</div>
      <LineChart
        data={data}
        xAxisKey="date"
        lines={[
          { dataKey: 'bronze', name: 'Bronze', color: '#CD7F32', areaFill: true },
          { dataKey: 'silver', name: 'Silver', color: '#C0C0C0', areaFill: true },
          { dataKey: 'golden', name: 'Golden', color: '#FFD700', areaFill: true },
        ]}
      />
    </div>
  );
}
