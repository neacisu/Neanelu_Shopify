import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { Cell, Legend, Pie, PieChart as RechartsPieChart, ResponsiveContainer } from 'recharts';

import { ChartTooltip, type ChartTooltipProps } from './ChartTooltip.js';
import { useChartTheme } from './theme.js';

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
  ariaLabel?: string;
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
  ariaLabel,
}: PieChartProps) {
  const safeHeight = Math.max(1, height);
  const { isDark, text } = useChartTheme();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const onCellEnter = useCallback((_: unknown, index: number) => {
    setHoveredIndex(index);
  }, []);

  const onCellLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const defaultAriaLabel = `Diagramă pie cu ${data.length} segmente: ${data.map((d) => `${d.name}: ${d.value}`).join(', ')}`;

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? defaultAriaLabel}
      className="motion-safe:animate-[chartFadeIn_0.5s_ease-out_0.1s_both]"
      style={{ width: '100%', height: safeHeight, minHeight: safeHeight, minWidth: 1 }}
    >
      <ResponsiveContainer width="100%" height={safeHeight} minWidth={1} minHeight={safeHeight}>
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
            animationDuration={900}
            animationBegin={100}
            onMouseEnter={onCellEnter}
            onMouseLeave={onCellLeave}
            {...(onSliceClick
              ? {
                  onClick: (_e: unknown, index: number) => {
                    const datum = data[index];
                    if (datum) onSliceClick(datum);
                  },
                  cursor: 'pointer',
                }
              : {})}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color ?? 'rgb(var(--color-muted))'}
                opacity={hoveredIndex !== null && hoveredIndex !== index ? 0.4 : 1}
                strokeWidth={hoveredIndex === index ? 2 : 0}
                stroke={
                  hoveredIndex === index
                    ? (entry.color ?? 'rgb(var(--color-muted))')
                    : isDark
                      ? 'rgb(var(--color-background))'
                      : 'rgb(var(--color-card))'
                }
                style={{ transition: 'opacity 0.2s ease-out, stroke-width 0.15s ease-out' }}
              />
            ))}
          </Pie>

          {centerLabel ? (
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontSize: 14, fontWeight: 600, fill: text.fill }}
            >
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
