import { useMemo } from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

export type GaugeChartProps = Readonly<{
  /** Current value to display */
  value: number;
  /** Maximum value (100% fill). Can be a fixed number or dynamically calculated. */
  max: number;
  /** Size of the gauge in pixels (width & height) */
  size?: number;
  /** Label shown below the value */
  label?: string;
  /** Color of the filled portion. Defaults to Polaris primary. */
  fillColor?: string;
  /** Color of the background track. Defaults to light gray. */
  trackColor?: string;
  /** Format function for displaying the value */
  formatValue?: (value: number) => string;
  /** Optional className for the container */
  className?: string;
}>;

const DEFAULT_SIZE = 80;
const DEFAULT_FILL_COLOR = '#008060'; // Polaris primary green
const DEFAULT_TRACK_COLOR = '#e4e5e7'; // Polaris subdued

/**
 * Circular gauge chart component using Recharts RadialBarChart.
 * Full 360° circle visualization for metrics like memory, CPU usage.
 *
 * @example
 * ```tsx
 * <GaugeChart
 *   value={heapUsed}
 *   max={heapTotal} // Dynamic max from process.memoryUsage()
 *   label="Heap"
 *   formatValue={formatBytes}
 * />
 * ```
 */
export function GaugeChart({
  value,
  max,
  size = DEFAULT_SIZE,
  label,
  fillColor = DEFAULT_FILL_COLOR,
  trackColor = DEFAULT_TRACK_COLOR,
  formatValue,
  className,
}: GaugeChartProps) {
  // Clamp percentage between 0-100
  const percentage = useMemo(() => {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.min(100, Math.max(0, (value / max) * 100));
  }, [value, max]);

  const data = useMemo(
    () => [
      {
        name: label ?? 'value',
        value: percentage,
        fill: fillColor,
      },
    ],
    [percentage, label, fillColor]
  );

  const displayValue = useMemo(() => {
    if (formatValue) return formatValue(value);
    if (!Number.isFinite(value)) return '—';
    return String(Math.round(value));
  }, [value, formatValue]);

  // Determine color based on usage threshold
  const dynamicFillColor = useMemo(() => {
    if (percentage >= 90) return '#d72c0d'; // Polaris critical
    if (percentage >= 75) return '#ffc453'; // Polaris warning
    return fillColor;
  }, [percentage, fillColor]);

  return (
    <div className={className} style={{ width: size, height: size, position: 'relative' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="70%"
          outerRadius="100%"
          barSize={8}
          data={data}
          startAngle={90}
          endAngle={-270} // Full 360° circle
        >
          {/* Background track */}
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: trackColor }}
            dataKey="value"
            cornerRadius={4}
            fill={dynamicFillColor}
          />
        </RadialBarChart>
      </ResponsiveContainer>

      {/* Center text overlay */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          lineHeight: 1.2,
        }}
      >
        <div className="text-xs font-mono font-medium">{displayValue}</div>
        {label && <div className="text-[10px] text-muted">{label}</div>}
      </div>
    </div>
  );
}

/**
 * Default gauge configuration with dynamic max from process memory.
 * Use this when you want heap max to be calculated from heapTotal.
 */
export function calculateDynamicMax(memoryInfo: {
  heapTotal?: number | undefined;
  rss?: number | undefined;
}): { heapMax: number; rssMax: number } {
  // Use actual heapTotal if available, otherwise default to 512MB
  const heapMax =
    memoryInfo.heapTotal && memoryInfo.heapTotal > 0 ? memoryInfo.heapTotal : 512 * 1024 * 1024;

  // For RSS, use 2x heapTotal as a reasonable max, or 1GB default
  const rssMax =
    memoryInfo.heapTotal && memoryInfo.heapTotal > 0
      ? memoryInfo.heapTotal * 2
      : 1024 * 1024 * 1024;

  return { heapMax, rssMax };
}
