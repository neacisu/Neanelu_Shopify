import type { ReactNode } from 'react';

import { Cell, Legend, Pie, PieChart as RechartsPieChart, ResponsiveContainer } from 'recharts';

import { ChartTooltip, type ChartTooltipProps } from './ChartTooltip.js';

export type PieChartDatum = Readonly<{
  name: string;
  value: number;
  color?: string;
}>;

export type PieChartProps = Readonly<{
  data: readonly PieChartDatum[];
  height?: number;
  showLabels?: boolean;
  showLegend?: boolean;
  onSliceClick?: (datum: PieChartDatum) => void;
  tooltipProps?: Omit<ChartTooltipProps, 'content'>;
  tooltipContent?: ChartTooltipProps['content'];
  centerLabel?: ReactNode;
  innerRadius?: number | string;
}>;

export function PieChart({
  data,
  height = 260,
  showLabels = false,
  showLegend = true,
  onSliceClick,
  tooltipProps,
  tooltipContent,
  centerLabel,
  innerRadius,
}: PieChartProps) {
  return (
    <div style={{ width: '100%', height, minHeight: 1, minWidth: 1 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <RechartsPieChart>
          <ChartTooltip content={tooltipContent} {...tooltipProps} />

          <Pie
            data={Array.from(data)}
            dataKey="value"
            nameKey="name"
            outerRadius="80%"
            {...(innerRadius !== undefined ? { innerRadius } : {})}
            label={showLabels}
            isAnimationActive
            {...(onSliceClick
              ? {
                  onClick: (_e: unknown, index: number) => {
                    const datum = data[index];
                    if (datum) onSliceClick(datum);
                  },
                }
              : {})}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>

          {centerLabel ? (
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
              {typeof centerLabel === 'string' || typeof centerLabel === 'number'
                ? centerLabel
                : ''}
            </text>
          ) : null}

          {showLegend ? <Legend /> : null}
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
