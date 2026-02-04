import type { PieChartDatum } from '../charts/PieChart';
import { DonutChart } from '../charts/DonutChart';

export type QualityDistribution = Readonly<{
  bronze: number;
  silver: number;
  golden: number;
  review: number;
}>;

export type QualityDistributionChartProps = Readonly<{
  total: number;
  distribution: QualityDistribution;
  onSliceClick?: (level: keyof QualityDistribution) => void;
}>;

export function QualityDistributionChart({
  total,
  distribution,
  onSliceClick,
}: QualityDistributionChartProps) {
  const data: PieChartDatum[] = [
    {
      name: 'Bronze',
      value: distribution.bronze,
      color: '#CD7F32',
    },
    {
      name: 'Silver',
      value: distribution.silver,
      color: '#C0C0C0',
    },
    {
      name: 'Golden',
      value: distribution.golden,
      color: '#FFD700',
    },
    {
      name: 'Review',
      value: distribution.review,
      color: '#FF6B6B',
    },
  ];

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Quality distribution</div>
      <DonutChart
        data={data}
        showLegend
        centerLabel={<span className="text-sm font-medium">{total}</span>}
        onSliceClick={(slice) => {
          const level = slice.name.toLowerCase() as keyof QualityDistribution;
          onSliceClick?.(level);
        }}
      />
    </div>
  );
}
