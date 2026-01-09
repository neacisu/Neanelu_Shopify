import {
  Area,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { chartColors } from './theme.js';
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
  const palette = [
    chartColors.blue,
    chartColors.green,
    chartColors.amber,
    chartColors.violet,
    chartColors.red,
    chartColors.gray,
  ] as const;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RechartsLineChart
          data={Array.from(data)}
          margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
        >
          <XAxis dataKey={xAxisKey} tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={40} />

          {showGrid ? (
            <ChartGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
          ) : null}
          {showTooltip ? <ChartTooltip content={tooltipContent} {...tooltipProps} /> : null}
          {showLegend ? <ChartLegend /> : null}

          {lines.map((line, index) => {
            const color = line.color ?? palette[index % palette.length] ?? chartColors.gray;
            const strokeWidth = line.strokeWidth ?? 2;
            const dot = line.showDots ? { r: 2 } : false;

            if (line.areaFill) {
              return (
                <Area
                  key={line.dataKey}
                  type="monotone"
                  dataKey={line.dataKey}
                  {...(line.name !== undefined ? { name: line.name } : {})}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15}
                  strokeWidth={strokeWidth}
                  dot={dot}
                  activeDot={{ r: 4 }}
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
                dot={dot}
                activeDot={{ r: 4 }}
              />
            );
          })}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
