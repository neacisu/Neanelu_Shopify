import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

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
}: BarChartProps<TData>) {
  const resolvedStackId = stacked ? 'stack' : undefined;

  return (
    <div style={{ width: '100%', height, minHeight: 1, minWidth: 1 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <RechartsBarChart
          data={Array.from(data)}
          layout={layout}
          margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
        >
          {showGrid ? (
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
          ) : null}

          <XAxis dataKey={xAxisKey} tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={40} />

          {showTooltip ? <ChartTooltip content={tooltipContent} {...tooltipProps} /> : null}
          {showLegend ? <ChartLegend /> : null}

          {bars.map((bar) => (
            <Bar
              key={bar.dataKey}
              dataKey={bar.dataKey}
              {...(bar.name !== undefined ? { name: bar.name } : {})}
              fill={bar.color}
              {...(() => {
                const stackId = bar.stackId ?? resolvedStackId;
                return stackId !== undefined ? { stackId } : {};
              })()}
              label={showValues ? { position: 'top', fontSize: 10 } : false}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
