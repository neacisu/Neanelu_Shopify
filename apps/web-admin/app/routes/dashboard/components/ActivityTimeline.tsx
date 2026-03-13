import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DashboardActivityResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';
import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis } from 'recharts';

import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { ChartContainer, ChartGrid, ChartTooltip } from '../../../components/charts/index.js';
import { useChartTheme } from '../../../components/charts/theme.js';
import { InfoTooltip } from '../../../components/ui/info-tooltip';
import { LoadingState, ErrorState } from '../../../components/patterns/index.js';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

type ActivityDatum = Readonly<{
  date: string;
  total: number;
  sync: number;
  webhook: number;
  bulk: number;
  aiBatch: number;
}>;

export type ActivityTooltipProps = Readonly<{
  active?: boolean;
  payload?: { payload?: ActivityDatum }[];
}>;

export function ActivityTooltipContent({ active, payload }: ActivityTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm ring-1 ring-border/60"
      style={{ minWidth: 160 }}
    >
      <div className="mb-2 font-semibold text-foreground">{datum.date}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">Total</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{datum.total}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">Sync</span>
          <span className="font-mono tabular-nums text-foreground">{datum.sync}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">Webhook</span>
          <span className="font-mono tabular-nums text-foreground">{datum.webhook}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">Bulk</span>
          <span className="font-mono tabular-nums text-foreground">{datum.bulk}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted">AI Batch</span>
          <span className="font-mono tabular-nums text-foreground">{datum.aiBatch}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityTimeline() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [chartDims, setChartDims] = useState<{ w: number; h: number } | null>(null);
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [visible, setVisible] = useState({
    total: true,
    sync: true,
    webhook: true,
    bulk: true,
    aiBatch: true,
  });
  const { text, grid } = useChartTheme();

  const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setChartDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    };

    measure();

    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(node);
  }, []);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  const query = useQuery({
    queryKey: ['dashboard', 'activity', days],
    queryFn: () => api.getApi<DashboardActivityResponse>(`/dashboard/activity?days=${days}`),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const data = useMemo<ActivityDatum[]>(() => {
    const points = query.data?.points ?? [];
    return points.map((p) => ({
      date: p.date,
      total: p.total,
      sync: p.breakdown.sync,
      webhook: p.breakdown.webhook,
      bulk: p.breakdown.bulk,
      aiBatch: p.breakdown.aiBatch,
    }));
  }, [query.data]);

  return (
    <ChartContainer
      title={
        <span className="flex items-center gap-1.5">
          Timeline activitate
          <InfoTooltip title="Timeline Activitate" side="bottom">
            CE ESTE: Grafic cu numărul de job-uri procesate pe zi, defalcate pe tip (Sync, Webhook,
            Bulk, AI Batch). DE CE CONTEAZĂ: Permite identificarea tendințelor de activitate și a
            zilelor cu încărcare mare. EXEMPLU: O creștere bruscă de webhooks poate indica
            modificări în masă în Shopify. SFAT: Filtrează tipurile de job-uri cu butoanele de sub
            grafic.
          </InfoTooltip>
        </span>
      }
      description={`Job-uri procesate pe zi (ultimele ${days} zile)`}
      height={260}
      actions={
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value as 7 | 14 | 30)}
              className={`interactive rounded border px-1.5 py-0.5 text-[10px] focus-ring-standard ${
                days === value
                  ? 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-xs)]'
                  : 'border-border bg-card text-muted hover:border-accent-border hover:bg-subtle/60 hover:text-foreground'
              }`}
            >
              {value}z
            </button>
          ))}
          {query.isFetching ? <span className="text-xs text-muted">Se actualizează…</span> : null}
        </div>
      }
    >
      {query.isLoading ? (
        <LoadingState label="Se încarcă activitatea…" />
      ) : query.isError ? (
        <ErrorState
          message={
            query.error instanceof Error ? query.error.message : 'Nu pot încărca activitatea.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div
            ref={containerCallbackRef}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          >
            {chartDims ? (
              <RechartsAreaChart
                width={chartDims.w}
                height={chartDims.h}
                data={data}
                margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
              >
                <ChartGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke={grid}
                  strokeOpacity={0.3}
                />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: grid }}
                  tick={{ fontSize: 11, fill: text.axis }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 11, fill: text.axis }}
                />

                <ChartTooltip
                  content={(p) => (
                    <ActivityTooltipContent {...(p as unknown as ActivityTooltipProps)} />
                  )}
                />

                {visible.sync ? (
                  <Area
                    type="monotone"
                    dataKey="sync"
                    name="Sync"
                    stackId="1"
                    stroke="rgb(var(--color-success))"
                    fill="rgb(var(--color-success))"
                    fillOpacity={0.4}
                    strokeWidth={1.5}
                    isAnimationActive
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                ) : null}
                {visible.webhook ? (
                  <Area
                    type="monotone"
                    dataKey="webhook"
                    name="Webhook"
                    stackId="1"
                    stroke="rgb(var(--color-warning))"
                    fill="rgb(var(--color-warning))"
                    fillOpacity={0.4}
                    strokeWidth={1.5}
                    isAnimationActive
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                ) : null}
                {visible.bulk ? (
                  <Area
                    type="monotone"
                    dataKey="bulk"
                    name="Bulk"
                    stackId="1"
                    stroke="rgb(var(--color-accent))"
                    fill="rgb(var(--color-accent))"
                    fillOpacity={0.4}
                    strokeWidth={1.5}
                    isAnimationActive
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                ) : null}
                {visible.aiBatch ? (
                  <Area
                    type="monotone"
                    dataKey="aiBatch"
                    name="AI Batch"
                    stackId="1"
                    stroke="rgb(var(--color-error))"
                    fill="rgb(var(--color-error))"
                    fillOpacity={0.4}
                    strokeWidth={1.5}
                    isAnimationActive
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                ) : null}
                {visible.total ? (
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="rgb(var(--color-primary))"
                    fill="none"
                    strokeWidth={2}
                    activeDot={{
                      r: 4,
                      fill: 'rgb(var(--color-primary))',
                      stroke: 'rgb(var(--color-card))',
                      strokeWidth: 2,
                    }}
                    isAnimationActive
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                ) : null}
              </RechartsAreaChart>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                ['total', 'Total'],
                ['sync', 'Sync'],
                ['webhook', 'Webhook'],
                ['bulk', 'Bulk'],
                ['aiBatch', 'AI Batch'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setVisible((state) => ({ ...state, [key]: !state[key] }))}
                className={`interactive rounded border px-2 py-0.5 text-[10px] focus-ring-standard ${
                  visible[key]
                    ? 'border-primary bg-primary/15 text-primary shadow-[var(--shadow-xs)]'
                    : 'border-border bg-card text-muted line-through hover:border-accent-border hover:bg-subtle/50 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ChartContainer>
  );
}
