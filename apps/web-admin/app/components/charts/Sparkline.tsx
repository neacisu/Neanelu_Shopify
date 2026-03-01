import { useId, useMemo } from 'react';
import { Area, AreaChart, Line, LineChart as RechartsLineChart } from 'recharts';

import { useChartTheme } from './theme';

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

const trendArrowColorsLight: Record<'up' | 'down' | 'flat', string> = {
  up: '#16a34a',
  down: '#dc2626',
  flat: '#64748b',
};

const trendArrowColorsDark: Record<'up' | 'down' | 'flat', string> = {
  up: '#4ade80',
  down: '#f87171',
  flat: '#94a3b8',
};

export function Sparkline({
  data,
  width = 50,
  height = 18,
  color,
  showChange = false,
  trend,
  areaFill = true,
}: SparklineProps) {
  const uid = useId().replace(/:/g, '');
  const { isDark, palette } = useChartTheme();
  const resolvedColor = color ?? palette[0];
  const points = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  const resolvedTrend = trend ?? computeTrend(data);
  const delta = (data[data.length - 1] ?? 0) - (data[0] ?? 0);
  const trendLabel = trendLabels[resolvedTrend];
  const arrowColors = isDark ? trendArrowColorsDark : trendArrowColorsLight;
  const arrowColor = arrowColors[resolvedTrend];

  const gradientId = `sparkline-grad-${uid}`;

  return (
    <div className="inline-flex items-center gap-1 animate-[chartFadeIn_0.35s_ease-out_both]">
      {areaFill ? (
        <AreaChart width={width} height={height} data={points}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={resolvedColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor={resolvedColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={resolvedColor}
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
            stroke={resolvedColor}
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
