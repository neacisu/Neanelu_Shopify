import { useMemo } from 'react';

export type GaugeThreshold = Readonly<{ value: number; color: string }>;

export type GaugeChartProps = Readonly<{
  value: number;
  min?: number;
  max: number;
  thresholds?: readonly GaugeThreshold[];
  size?: number;
  showValue?: boolean;
  label?: string;
  formatValue?: (value: number) => string;
  className?: string;
  /** Back-compat: overrides progress color if thresholds are not provided. */
  fillColor?: string;
  /** Back-compat: track / zone background. */
  trackColor?: string;
}>;

const DEFAULT_SIZE = 84;
const DEFAULT_TRACK_COLOR = '#e4e5e7';
const DEFAULT_FILL_COLOR = '#008060';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function resolveColor(
  value: number,
  thresholds: readonly GaugeThreshold[] | undefined,
  fallback: string
): string {
  if (!thresholds?.length) return fallback;
  const sorted = thresholds.slice().sort((a, b) => a.value - b.value);
  let color = sorted[0]?.color ?? fallback;
  for (const t of sorted) {
    if (value >= t.value) color = t.color;
  }
  return color;
}

export function GaugeChart({
  value,
  min = 0,
  max,
  thresholds,
  size = DEFAULT_SIZE,
  showValue = true,
  label,
  formatValue,
  className,
  fillColor = DEFAULT_FILL_COLOR,
  trackColor = DEFAULT_TRACK_COLOR,
}: GaugeChartProps) {
  const safeMax = Number.isFinite(max) && max > min ? max : min + 1;
  const safeValue = Number.isFinite(value) ? value : min;
  const pct = clamp((safeValue - min) / (safeMax - min), 0, 1);

  const displayValue = useMemo(() => {
    if (!showValue) return '';
    if (formatValue) return formatValue(safeValue);
    return Number.isFinite(safeValue) ? String(Math.round(safeValue)) : '—';
  }, [formatValue, safeValue, showValue]);

  // Semi-circle gauge: angles from -180 (left) to 0 (right)
  const startAngle = -180;
  const endAngle = 0;
  const needleAngle = startAngle + pct * (endAngle - startAngle);

  const strokeWidth = Math.max(6, Math.floor(size / 14));
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const progressColor = resolveColor(safeValue, thresholds, fillColor);

  const zoneSegments = useMemo(() => {
    const segs: { from: number; to: number; color: string }[] = [];
    const sorted = (
      thresholds?.length
        ? thresholds
        : [
            { value: min + 0.75 * (safeMax - min), color: '#ffc453' },
            { value: min + 0.9 * (safeMax - min), color: '#d72c0d' },
          ]
    )
      .slice()
      .sort((a, b) => a.value - b.value);

    let prev = min;
    let prevColor = trackColor;
    for (const t of sorted) {
      const v = clamp(t.value, min, safeMax);
      if (v > prev) {
        segs.push({ from: prev, to: v, color: prevColor });
      }
      prev = v;
      prevColor = t.color;
    }
    if (prev < safeMax) segs.push({ from: prev, to: safeMax, color: prevColor });
    return segs;
  }, [thresholds, min, safeMax, trackColor]);

  const toAngle = (v: number) => startAngle + clamp((v - min) / (safeMax - min), 0, 1) * 180;

  const progressArc = describeArc(cx, cy, r, startAngle, startAngle + pct * 180);

  return (
    <div className={className} style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* zones */}
        {zoneSegments.map((seg, idx) => (
          <path
            key={`zone-${idx}`}
            d={describeArc(cx, cy, r, toAngle(seg.from), toAngle(seg.to))}
            stroke={seg.color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            opacity={0.35}
          />
        ))}

        {/* progress */}
        <path
          d={progressArc}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />

        {/* needle */}
        <g
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transform: `rotate(${needleAngle}deg)`,
            transition: 'transform 500ms ease',
          }}
        >
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - r + strokeWidth}
            stroke="currentColor"
            strokeWidth={2}
            opacity={0.65}
          />
        </g>
        <circle cx={cx} cy={cy} r={3} fill="currentColor" opacity={0.65} />
      </svg>

      {showValue || label ? (
        <div
          style={{
            position: 'absolute',
            top: '56%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            lineHeight: 1.2,
            width: '100%',
          }}
        >
          {showValue ? <div className="text-xs font-mono font-medium">{displayValue}</div> : null}
          {label ? <div className="text-[10px] text-muted">{label}</div> : null}
        </div>
      ) : null}
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
