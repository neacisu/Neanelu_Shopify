import { useCallback, useState } from 'react';

import { Bar, BarChart as RechartsBarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { useChartTheme } from './theme.js';
import { ChartGrid } from './ChartGrid.js';
import { ChartLegend } from './ChartLegend.js';
import { ChartTooltip, type ChartTooltipProps } from './ChartTooltip.js';

export type BarDefinition<TData extends Record<string, unknown>> = Readonly<{
  dataKey: keyof TData & string;
  name?: string;
  color?: string;
  stackId?: string;
}>;

export type BarChartProps<TData extends Record<string, unknown>> = Readonly<{
  data: readonly TData[];
  bars: readonly BarDefinition<TData>[];
  xAxisKey: keyof TData & string;
  height?: number;
  layout?: 'horizontal' | 'vertical';
  stacked?: boolean;
  showValues?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  showLegend?: boolean;
  tooltipProps?: Omit<ChartTooltipProps, 'content'>;
  tooltipContent?: ChartTooltipProps['content'];
}>;

export function BarChart<TData extends Record<string, unknown>>({
  data,
  bars,
  xAxisKey,
  height = 260,
  layout = 'horizontal',
  stacked = false,
  showValues = false,
  showGrid = true,
  showTooltip = true,
  showLegend = true,
  tooltipProps,
  tooltipContent,
  ariaLabel,
}: BarChartProps<TData> & { ariaLabel?: string }) {
  const safeHeight = Math.max(1, height);
  const resolvedStackId = stacked ? 'stack' : undefined;
  const { text, grid } = useChartTheme();

  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  const onBarEnter = useCallback((dataKey: string) => {
    setHoveredBar(dataKey);
  }, []);

  const onBarLeave = useCallback(() => {
    setHoveredBar(null);
  }, []);

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? `Bar chart cu ${data.length} puncte de date`}
      className="motion-safe:animate-[chartFadeIn_0.5s_ease-out_both]"
      style={{ width: '100%', height: safeHeight, minHeight: safeHeight, minWidth: 1 }}
    >
      <ResponsiveContainer width="100%" height={safeHeight} minWidth={1} minHeight={safeHeight}>
        <RechartsBarChart
          data={Array.from(data)}
          layout={layout}
          margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
        >
          {showGrid ? (
            <ChartGrid strokeDasharray="3 3" vertical={false} stroke={grid} strokeOpacity={0.4} />
          ) : null}

          <XAxis
            dataKey={xAxisKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: text.axis }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fontSize: 11, fill: text.axis }}
          />

          {showTooltip ? <ChartTooltip content={tooltipContent} {...tooltipProps} /> : null}
          {showLegend ? <ChartLegend /> : null}

          {bars.map((bar, barIndex) => {
            const barOpacity = hoveredBar === null ? 1 : hoveredBar === bar.dataKey ? 1 : 0.35;

            return (
              <Bar
                key={bar.dataKey}
                dataKey={bar.dataKey}
                {...(bar.name !== undefined ? { name: bar.name } : {})}
                fill={bar.color}
                fillOpacity={barOpacity}
                {...(() => {
                  const stackId = bar.stackId ?? resolvedStackId;
                  return stackId !== undefined ? { stackId } : {};
                })()}
                label={showValues ? { position: 'top', fontSize: 10, fill: text.fill } : false}
                radius={[4, 4, 0, 0]}
                isAnimationActive
                animationDuration={800}
                animationBegin={barIndex * 80}
                animationEasing="ease-out"
                onMouseEnter={() => onBarEnter(bar.dataKey)}
                onMouseLeave={onBarLeave}
                style={{ transition: 'fill-opacity 0.2s ease-out' }}
              />
            );
          })}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
