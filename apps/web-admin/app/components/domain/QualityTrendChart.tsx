import { useMemo, type ReactNode } from 'react';
import { LineChart } from '../charts/LineChart';
import { ChartTooltipContent } from '../charts/ChartTooltip';
import type { ChartTooltipContentProps } from '../charts/ChartTooltip';

export type QualityTrendPoint = Readonly<{
  date: string;
  bronze: number;
  silver: number;
  golden: number;
}>;

export type QualityTrendChartProps = Readonly<{
  data: readonly QualityTrendPoint[];
  rangeLabel?: string;
}>;

function formatDateLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  const d = new Date(label);
  return Number.isNaN(d.getTime()) ? label : d.toLocaleDateString('ro-RO');
}

export function QualityTrendChart({ data, rangeLabel }: QualityTrendChartProps) {
  const tooltipContent = useMemo(
    () => (props: ChartTooltipContentProps) => {
      const label = props.label;
      const formatted = typeof label === 'string' ? formatDateLabel(label) : (label as ReactNode);
      return <ChartTooltipContent {...props} label={formatted} />;
    },
    []
  );

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4 transition-colors hover:border-muted/40">
      <div className="mb-2 text-xs text-primary">
        {rangeLabel ? `Evoluție calitate (${rangeLabel})` : 'Evoluție calitate'}
      </div>
      <LineChart
        data={data}
        xAxisKey="date"
        tooltipContent={tooltipContent}
        lines={[
          { dataKey: 'bronze', name: 'Bronze', color: 'rgb(var(--color-bronze))', areaFill: true },
          { dataKey: 'silver', name: 'Silver', color: 'rgb(var(--color-silver))', areaFill: true },
          {
            dataKey: 'golden',
            name: 'Golden Record',
            color: 'rgb(var(--color-golden))',
            areaFill: true,
          },
        ]}
      />
    </div>
  );
}
