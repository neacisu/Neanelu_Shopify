import type { PieChartDatum } from '../charts/PieChart';
import { InfoTooltip } from '../ui/info-tooltip';
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
      color: 'rgb(var(--color-bronze))',
    },
    {
      name: 'Silver',
      value: distribution.silver,
      color: 'rgb(var(--color-silver))',
    },
    {
      name: 'Golden',
      value: distribution.golden,
      color: 'rgb(var(--color-golden))',
    },
    {
      name: 'Review',
      value: distribution.review,
      color: 'rgb(var(--color-review))',
    },
  ];

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
        <span>Distribuție calitate</span>
        <InfoTooltip title="Distribuție calitate">
          Bronze: date minime. Silver: îmbunătățite. Golden: complete. Review: necesită revizuire
          manuală.
        </InfoTooltip>
      </div>
      <DonutChart
        data={data}
        showLegend
        centerLabel={total}
        onSliceClick={(slice) => {
          const level = slice.name.toLowerCase() as keyof QualityDistribution;
          onSliceClick?.(level);
        }}
      />
    </div>
  );
}
