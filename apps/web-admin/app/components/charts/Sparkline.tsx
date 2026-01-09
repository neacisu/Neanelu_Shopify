import { useMemo } from 'react';
import { Line, LineChart as RechartsLineChart } from 'recharts';

export type SparklineProps = Readonly<{
  data: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  showChange?: boolean;
  /** If provided, overrides auto trend detection. */
  trend?: 'up' | 'down' | 'flat';
}>;

function computeTrend(values: readonly number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

export function Sparkline({
  data,
  width = 50,
  height = 18,
  color = '#008060',
  showChange = false,
  trend,
}: SparklineProps) {
  const points = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  const resolvedTrend = trend ?? computeTrend(data);
  const delta = (data[data.length - 1] ?? 0) - (data[0] ?? 0);

  return (
    <div className="inline-flex items-center gap-1">
      <RechartsLineChart width={width} height={height} data={points}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
      </RechartsLineChart>

      {showChange ? (
        <span className="text-[10px] font-mono" aria-label={resolvedTrend} title={resolvedTrend}>
          {resolvedTrend === 'up' ? '+' : resolvedTrend === 'down' ? '-' : ''}
          {Math.abs(delta).toFixed(0)}
        </span>
      ) : null}
    </div>
  );
}
