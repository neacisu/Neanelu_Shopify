import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DashboardActivityResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';
import { LineChart as RechartsLineChart, Line, XAxis, YAxis } from 'recharts';

import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { ChartContainer, ChartGrid, ChartTooltip } from '../../../components/charts/index.js';
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
      className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg ring-1 ring-slate-200/80"
      style={{ minWidth: 160 }}
    >
      <div className="mb-2 font-semibold text-slate-800">{datum.date}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Total</span>
          <span className="font-mono font-medium tabular-nums text-slate-800">{datum.total}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Sync</span>
          <span className="font-mono tabular-nums text-slate-700">{datum.sync}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Webhook</span>
          <span className="font-mono tabular-nums text-slate-700">{datum.webhook}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Bulk</span>
          <span className="font-mono tabular-nums text-slate-700">{datum.bulk}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">AI Batch</span>
          <span className="font-mono tabular-nums text-slate-700">{datum.aiBatch}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityTimeline() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [chartDims, setChartDims] = useState<{ w: number; h: number } | null>(null);

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
    queryKey: ['dashboard', 'activity', 7],
    queryFn: () => api.getApi<DashboardActivityResponse>('/dashboard/activity?days=7'),
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
      title="Timeline activitate"
      description="Job-uri procesate pe zi (ultimele 7 zile)"
      height={260}
      actions={
        query.isFetching ? <span className="text-xs text-slate-500">Se actualizează…</span> : null
      }
    >
      {query.isLoading ? (
        <LoadingState label="Se incarca activitatea…" />
      ) : query.isError ? (
        <ErrorState
          message={
            query.error instanceof Error ? query.error.message : 'Nu pot incarca activitatea.'
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
              <RechartsLineChart
                width={chartDims.w}
                height={chartDims.h}
                data={data}
                margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
              >
                <ChartGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-200/60" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                />

                <ChartTooltip
                  content={(p) => (
                    <ActivityTooltipContent {...(p as unknown as ActivityTooltipProps)} />
                  )}
                />

                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive
                  animationDuration={400}
                  animationEasing="ease-out"
                />
              </RechartsLineChart>
            ) : null}
          </div>
        </div>
      )}
    </ChartContainer>
  );
}
