import { useCallback, useState } from 'react';

import {
  Area,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { useChartTheme } from './theme.js';
import { ChartGrid } from './ChartGrid.js';
import { ChartLegend } from './ChartLegend.js';
import { ChartTooltip, type ChartTooltipProps } from './ChartTooltip.js';

export type LineDefinition<TData extends Record<string, unknown>> = Readonly<{
  dataKey: keyof TData & string;
  name?: string;
  color?: string;
  strokeWidth?: number;
  showDots?: boolean;
  areaFill?: boolean;
}>;

export type LineChartProps<TData extends Record<string, unknown>> = Readonly<{
  data: readonly TData[];
  lines: readonly LineDefinition<TData>[];
  xAxisKey: keyof TData & string;
  height?: number;
  showGrid?: boolean;
  showTooltip?: boolean;
  showLegend?: boolean;
  tooltipProps?: Omit<ChartTooltipProps, 'content'>;
  tooltipContent?: ChartTooltipProps['content'];
}>;

export function LineChart<TData extends Record<string, unknown>>({
  data,
  lines,
  xAxisKey,
  height = 260,
  showGrid = true,
  showTooltip = true,
  showLegend = true,
  tooltipProps,
  tooltipContent,
}: LineChartProps<TData>) {
  const safeHeight = Math.max(1, height);
  const { palette, text, grid } = useChartTheme();

  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);

  const handleMouseEnter = useCallback((dataKey: string) => {
    setHoveredSeries(dataKey);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredSeries(null);
  }, []);

  return (
    <div
      className="animate-[chartFadeIn_0.5s_ease-out_0.05s_both]"
      style={{ width: '100%', height: safeHeight, minHeight: safeHeight, minWidth: 1 }}
    >
      <ResponsiveContainer width="100%" height={safeHeight} minWidth={1} minHeight={safeHeight}>
        <RechartsLineChart
          data={Array.from(data)}
          margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
          style={{ cursor: hoveredSeries ? 'crosshair' : undefined }}
        >
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

          {showGrid ? (
            <ChartGrid strokeDasharray="3 3" vertical={false} stroke={grid} strokeOpacity={0.4} />
          ) : null}
          {showTooltip ? <ChartTooltip content={tooltipContent} {...tooltipProps} /> : null}
          {showLegend ? <ChartLegend /> : null}

          {lines.map((line, index) => {
            const color = line.color ?? palette[index % palette.length] ?? '#64748b';
            const strokeWidth = line.strokeWidth ?? 2;
            const dot = line.showDots ? { r: 2 } : false;
            const seriesOpacity =
              hoveredSeries === null ? 1 : hoveredSeries === line.dataKey ? 1 : 0.25;

            if (line.areaFill) {
              return (
                <Area
                  key={line.dataKey}
                  type="monotone"
                  dataKey={line.dataKey}
                  {...(line.name !== undefined ? { name: line.name } : {})}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15 * seriesOpacity}
                  strokeWidth={strokeWidth}
                  strokeOpacity={seriesOpacity}
                  dot={dot}
                  activeDot={{ r: 4 }}
                  isAnimationActive
                  animationDuration={800}
                  animationEasing="ease-out"
                  onMouseEnter={() => handleMouseEnter(line.dataKey)}
                  onMouseLeave={handleMouseLeave}
                  style={{ transition: 'opacity 0.2s ease-out' }}
                />
              );
            }

            return (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                {...(line.name !== undefined ? { name: line.name } : {})}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeOpacity={seriesOpacity}
                dot={dot}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={800}
                animationEasing="ease-out"
                onMouseEnter={() => handleMouseEnter(line.dataKey)}
                onMouseLeave={handleMouseLeave}
                style={{ transition: 'opacity 0.2s ease-out' }}
              />
            );
          })}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
