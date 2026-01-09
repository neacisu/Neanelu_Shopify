import { useMemo } from 'react';

import type { DashboardActivityResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';
import { LineChart as RechartsLineChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts';

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
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{datum.date}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Total</span>
          <span className="font-mono">{datum.total}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Sync</span>
          <span className="font-mono">{datum.sync}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Webhook</span>
          <span className="font-mono">{datum.webhook}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Bulk</span>
          <span className="font-mono">{datum.bulk}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">AI Batch</span>
          <span className="font-mono">{datum.aiBatch}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityTimeline() {
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
      title="Activity Timeline"
      description="Jobs processed per day (last 7 days)"
      height={260}
      actions={query.isFetching ? <div className="text-caption text-muted">Updating…</div> : null}
    >
      {query.isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Failed to load activity'}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <RechartsLineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
            <ChartGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={40} />

            <ChartTooltip
              content={(p) => (
                <ActivityTooltipContent {...(p as unknown as ActivityTooltipProps)} />
              )}
            />

            <Line
              type="monotone"
              dataKey="total"
              name="Total"
              stroke="#008060"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
