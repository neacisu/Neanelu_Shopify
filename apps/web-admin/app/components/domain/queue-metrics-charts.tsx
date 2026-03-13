import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { useChartTheme } from '../charts/theme';

import { InfoTooltip } from '../ui/info-tooltip';

export type QueueMetricsPoint = Readonly<{
  ts: number;
  timestamp: string;
  throughputJobsPerSec: number;
  completedDelta: number;
  failedDelta: number;
}>;

export interface QueueStatusDistribution {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly completed: number;
}

const CHART_HEIGHT = 200;
const PIE_SIZE = 160;

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('ro-RO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

const cardBase =
  'overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-[box-shadow,border-color] duration-normal hover:border-accent-border/70 hover:shadow-[var(--shadow-md)]';

export function QueueMetricsCharts(props: {
  points: QueueMetricsPoint[];
  distribution?: QueueStatusDistribution | null;
}) {
  const reducedMotion = useReducedMotion();
  const theme = useChartTheme();
  const { points, distribution = null } = props;

  const COLORS = {
    throughput: theme.palette[1] ?? 'rgb(var(--chart-2))',
    throughputFill: 'url(#throughputGradient)',
    completed: theme.semantic.success,
    completedFill: 'url(#completedGradient)',
    failed: theme.semantic.danger,
    failedFill: 'url(#failedGradient)',
    waiting: theme.semantic.warning,
    active: theme.palette[0] ?? 'rgb(var(--chart-1))',
    delayed: theme.palette[3] ?? 'rgb(var(--chart-4))',
    distFailed: theme.semantic.danger,
    distCompleted: theme.semantic.success,
  };

  const tooltipContentStyle = {
    padding: '10px 14px',
    borderRadius: '10px',
    border: `1px solid ${theme.semantic.tooltipBorder}`,
    background: theme.semantic.tooltipBg,
    boxShadow: 'var(--shadow-md)',
    fontSize: '12px',
  };

  const distData = distribution
    ? [
        { name: 'În așteptare', value: distribution.waiting, color: COLORS.waiting },
        { name: 'Active', value: distribution.active, color: COLORS.active },
        { name: 'Amânate', value: distribution.delayed, color: COLORS.delayed },
        { name: 'Eșuate', value: distribution.failed, color: COLORS.distFailed },
        { name: 'Finalizate', value: distribution.completed, color: COLORS.distCompleted },
      ].filter((d) => d.value > 0)
    : [];

  const totalDist = distData.reduce((s, d) => s + d.value, 0);

  return (
    <>
      <article className={cardBase}>
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
          Throughput (jobs/s)
          <InfoTooltip title="Throughput" side="bottom" maxWidth={320}>
            Numărul de job-uri finalizate pe secundă în ultimele minute. O valoare ridicată înseamnă
            că coada procesează rapid. Linia roșie indică limita recomandată (50 jobs/s).
          </InfoTooltip>
        </h3>
        <div style={{ width: '100%', height: CHART_HEIGHT, minHeight: 1 }}>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT} minWidth={1} minHeight={1}>
            <AreaChart
              data={points}
              margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              style={reducedMotion ? {} : { animation: 'chartFadeIn 0.5s ease-out' }}
            >
              <defs>
                <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.throughput} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.throughput} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                className="[&_line]:stroke-border dark:[&_line]:stroke-border"
                stroke={theme.grid}
                vertical={false}
              />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTs}
                tick={{ fontSize: 11 }}
                className="[&_text]:fill-muted"
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="[&_text]:fill-muted"
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(v) => formatTs(Number(v))}
                formatter={(value: number | undefined) => [
                  `${Number(value ?? 0).toFixed(2)} jobs/s`,
                  'Throughput',
                ]}
              />
              <ReferenceLine
                y={50}
                stroke={theme.semantic.danger}
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                label={{
                  value: 'Limit 50',
                  position: 'insideTopRight',
                  fill: theme.semantic.danger,
                  fontSize: 10,
                }}
              />
              <Area
                type="monotone"
                dataKey="throughputJobsPerSec"
                stroke={COLORS.throughput}
                strokeWidth={2}
                fill={COLORS.throughputFill}
                isAnimationActive
                animationDuration={300}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className={cardBase}>
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
          Rezultate (delta)
          <InfoTooltip title="Rezultate" side="bottom" maxWidth={320}>
            Modificarea numărului de job-uri finalizate (verde) și eșuate (roșu) între măsurători.
            Ajută să vezi dacă apar eșecuri în rafală sau dacă procesarea merge bine.
          </InfoTooltip>
        </h3>
        <div style={{ width: '100%', height: CHART_HEIGHT, minHeight: 1 }}>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT} minWidth={1} minHeight={1}>
            <LineChart
              data={points}
              margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              style={reducedMotion ? {} : { animation: 'chartFadeIn 0.5s ease-out 0.05s both' }}
            >
              <defs>
                <linearGradient id="completedGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={COLORS.completed} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={COLORS.completed} stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="failedGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={COLORS.failed} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={COLORS.failed} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTs}
                tick={{ fontSize: 11, fill: theme.text.axis }}
                axisLine={{ stroke: theme.grid }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: theme.text.axis }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(v) => formatTs(Number(v))}
                formatter={(value: number | undefined, name: string | undefined) => [
                  value ?? 0,
                  name === 'completedDelta' ? 'Finalizate' : 'Eșuate',
                ]}
              />
              <Line
                type="monotone"
                dataKey="completedDelta"
                stroke={COLORS.completed}
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={300}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="failedDelta"
                stroke={COLORS.failed}
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={300}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className={cardBase}>
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
          Distribuție status
          <InfoTooltip title="Distribuție status" side="bottom" maxWidth={340}>
            Repartiția job-urilor pe stări: în așteptare, active, amânate, finalizate, eșuate. Oferă
            o imagine de ansamblu rapidă asupra sănătății cozii.
          </InfoTooltip>
        </h3>
        {distData.length > 0 ? (
          <div
            style={{ width: '100%', height: CHART_HEIGHT + 24, minHeight: 1 }}
            className="relative flex items-center justify-center"
          >
            <ResponsiveContainer width="100%" height={PIE_SIZE + 24} minWidth={1} minHeight={1}>
              <PieChart
                style={
                  reducedMotion
                    ? {}
                    : {
                        animation: 'chartFadeIn 0.5s ease-out 0.1s both',
                      }
                }
              >
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  formatter={(value: number | undefined, name: string | undefined) => {
                    const v = value ?? 0;
                    return [
                      `${v} (${totalDist ? ((v / totalDist) * 100).toFixed(0) : 0}%)`,
                      name ?? '',
                    ];
                  }}
                />
                <Pie
                  data={distData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={PIE_SIZE * 0.45}
                  outerRadius={PIE_SIZE * 0.5}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive
                  animationDuration={350}
                  animationEasing="ease-out"
                >
                  {distData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {totalDist > 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold tabular-nums text-foreground">{totalDist}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted">total</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted">
            Fără date de distribuție
          </div>
        )}
      </article>
    </>
  );
}
