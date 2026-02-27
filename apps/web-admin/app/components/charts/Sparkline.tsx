import { useId, useMemo } from 'react';
import { Area, AreaChart, Line, LineChart as RechartsLineChart } from 'recharts';

export type SparklineProps = Readonly<{
  data: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  showChange?: boolean;
  /** If provided, overrides auto trend detection. */
  trend?: 'up' | 'down' | 'flat';
  /** Show gradient area fill beneath the line. */
  areaFill?: boolean;
}>;

function computeTrend(values: readonly number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

/** Etichete trend în română pentru accesibilitate. */
const trendLabels: Record<'up' | 'down' | 'flat', string> = {
  up: 'creștere',
  down: 'scădere',
  flat: 'constant',
};

const trendArrowColors: Record<'up' | 'down' | 'flat', string> = {
  up: '#16a34a',
  down: '#dc2626',
  flat: '#64748b',
};

export function Sparkline({
  data,
  width = 50,
  height = 18,
  color = '#008060',
  showChange = false,
  trend,
  areaFill = true,
}: SparklineProps) {
  const uid = useId().replace(/:/g, '');
  const points = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  const resolvedTrend = trend ?? computeTrend(data);
  const delta = (data[data.length - 1] ?? 0) - (data[0] ?? 0);
  const trendLabel = trendLabels[resolvedTrend];
  const arrowColor = trendArrowColors[resolvedTrend];

  const gradientId = `sparkline-grad-${uid}`;

  return (
    <div className="inline-flex items-center gap-1 animate-[chartFadeIn_0.35s_ease-out_both]">
      {areaFill ? (
        <AreaChart width={width} height={height} data={points}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive
            animationDuration={400}
            animationEasing="ease-out"
          />
        </AreaChart>
      ) : (
        <RechartsLineChart width={width} height={height} data={points}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive
            animationDuration={400}
            animationEasing="ease-out"
          />
        </RechartsLineChart>
      )}

      {showChange ? (
        <span
          className="text-[10px] font-mono"
          style={{ color: arrowColor }}
          aria-label={trendLabel}
          title={trendLabel}
        >
          {resolvedTrend === 'up' ? '▲' : resolvedTrend === 'down' ? '▼' : '—'}
          {Math.abs(delta).toFixed(0)}
        </span>
      ) : null}
    </div>
  );
}
