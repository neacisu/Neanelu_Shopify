import { useId, useMemo } from 'react';

import { useChartTheme } from './theme.js';

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
  /** Accessibility label for assistive technologies. */
  ariaLabel?: string;
}>;

const DEFAULT_SIZE = 84;
const DEFAULT_FILL_COLOR = '#0ea5e9';

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

/** Lighten hex color by a factor (0–1). Returns same color if not hex. */
function lightenHex(hex: string, factor: number): string {
  const n = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return hex;
  const r = Math.min(
    255,
    Math.round(parseInt(n.slice(0, 2), 16) + (255 - parseInt(n.slice(0, 2), 16)) * factor)
  );
  const g = Math.min(
    255,
    Math.round(parseInt(n.slice(2, 4), 16) + (255 - parseInt(n.slice(2, 4), 16)) * factor)
  );
  const b = Math.min(
    255,
    Math.round(parseInt(n.slice(4, 6), 16) + (255 - parseInt(n.slice(4, 6), 16)) * factor)
  );
  return `rgb(${r}, ${g}, ${b})`;
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
  trackColor,
  ariaLabel,
}: GaugeChartProps) {
  const uid = useId().replace(/:/g, '');
  const { semantic } = useChartTheme();

  const resolvedTrackColor = trackColor ?? semantic.track;
  const safeMax = Number.isFinite(max) && max > min ? max : min + 1;
  const safeValue = Number.isFinite(value) ? value : min;
  const pct = clamp((safeValue - min) / (safeMax - min), 0, 1);

  const displayValue = useMemo(() => {
    if (!showValue) return '';
    if (formatValue) return formatValue(safeValue);
    return Number.isFinite(safeValue) ? String(Math.round(safeValue)) : '—';
  }, [formatValue, safeValue, showValue]);

  const startAngle = -180;
  const endAngle = 0;
  const needleAngle = startAngle + pct * (endAngle - startAngle);

  const strokeWidth = Math.max(5, Math.floor(size / 12));
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const progressColor = resolveColor(safeValue, thresholds, fillColor);
  const arcLength = Math.PI * r;
  const dashOffset = arcLength * (1 - pct);

  const fullArcD = useMemo(
    () => describeArc(cx, cy, r, startAngle, endAngle),
    [cx, cy, r, startAngle, endAngle]
  );

  const gradientFrom = progressColor.startsWith('#')
    ? lightenHex(progressColor, 0.5)
    : progressColor;
  const gradientTo = progressColor;

  const zoneSegments = useMemo(() => {
    const segs: { from: number; to: number; color: string }[] = [];
    const sorted = (
      thresholds?.length
        ? thresholds
        : [
            { value: min + 0.75 * (safeMax - min), color: semantic.warning },
            { value: min + 0.9 * (safeMax - min), color: semantic.danger },
          ]
    )
      .slice()
      .sort((a, b) => a.value - b.value);

    let prev = min;
    let prevColor = resolvedTrackColor;
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
  }, [thresholds, min, safeMax, resolvedTrackColor, semantic.warning, semantic.danger]);

  const toAngle = (v: number) => startAngle + clamp((v - min) / (safeMax - min), 0, 1) * 180;

  return (
    <div
      className={`gauge-chart ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        position: 'relative',
        animation: 'gaugeEnter 0.5s ease-out both',
      }}
      role="img"
      aria-label={ariaLabel ?? `Gauge ${displayValue}${label ? ` ${label}` : ''}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        <defs>
          <linearGradient
            id={`gauge-grad-${uid}`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={cy}
            x2={size}
            y2={cy}
          >
            <stop offset="0%" stopColor={gradientFrom} stopOpacity={0.9} />
            <stop offset="100%" stopColor={gradientTo} stopOpacity={1} />
          </linearGradient>
          <filter id={`gauge-glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track: full semicircle */}
        <path
          d={fullArcD}
          fill="none"
          stroke={resolvedTrackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.25}
          style={{ transition: 'stroke 0.3s ease, opacity 0.3s ease' }}
        />

        {/* Zone segments (threshold bands) */}
        {zoneSegments.map((seg, idx) => (
          <path
            key={`zone-${idx}`}
            d={describeArc(cx, cy, r, toAngle(seg.from), toAngle(seg.to))}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            opacity={0.2}
            style={{ transition: 'stroke 0.3s ease, opacity 0.3s ease' }}
          />
        ))}

        {/* Progress arc: animated fill via stroke-dashoffset with spring-like transition */}
        <path
          d={fullArcD}
          fill="none"
          stroke={thresholds?.length ? progressColor : `url(#gauge-grad-${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={dashOffset}
          filter={thresholds?.length ? undefined : `url(#gauge-glow-${uid})`}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transition: 'stroke-dashoffset 1s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.3s ease',
          }}
        />

        {/* Needle: spring transition */}
        <g
          aria-hidden="true"
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transform: `rotate(${needleAngle}deg)`,
            transition: 'transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - r + strokeWidth + 2}
            stroke={semantic.needle}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          />
        </g>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={semantic.centerDot}
          stroke={semantic.centerDotStroke}
          strokeWidth={1.5}
          opacity={0.9}
        />
      </svg>

      {showValue || label ? (
        <div
          className="pointer-events-none"
          style={{
            position: 'absolute',
            top: '58%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            lineHeight: 1.2,
            width: '100%',
          }}
        >
          {showValue ? (
            <div
              key={displayValue}
              className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200"
              style={{ animation: 'gaugeValuePop 0.4s ease-out both' }}
            >
              {displayValue}
            </div>
          ) : null}
          {label ? (
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {label}
            </div>
          ) : null}
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
  const heapMax =
    memoryInfo.heapTotal && memoryInfo.heapTotal > 0 ? memoryInfo.heapTotal : 512 * 1024 * 1024;

  const rssMax =
    memoryInfo.heapTotal && memoryInfo.heapTotal > 0
      ? memoryInfo.heapTotal * 2
      : 1024 * 1024 * 1024;

  return { heapMax, rssMax };
}
