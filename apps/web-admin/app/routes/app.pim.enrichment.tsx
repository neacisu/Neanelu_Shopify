import type { LoaderFunctionArgs } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useLoaderData, useRevalidator, useSearchParams } from 'react-router-dom';
import type { DateRange } from 'react-day-picker';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { Timeline, type TimelineEvent } from '../components/ui/Timeline';
import { EnrichmentPipelineViz } from '../components/domain/EnrichmentPipelineViz';
import { EnrichmentProgressChart } from '../components/domain/EnrichmentProgressChart';
import { SourcePerformanceTable } from '../components/domain/SourcePerformanceTable';
import { EnrichmentStatsCards } from '../components/domain/EnrichmentStatsCards';
import { DataFreshnessIndicator } from '../components/domain/DataFreshnessIndicator';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { toUtcIsoRange } from '../utils/date-range';
import { useEnrichmentStream } from '../hooks/useEnrichmentStream';
import { useApiClient } from '../hooks/use-api';

interface EnrichmentStage {
  id: string;
  name: string;
  count: number;
  status: 'idle' | 'active' | 'bottleneck';
  avgDuration: number | null;
}

interface EnrichmentProgressResponse {
  pending: number;
  inProgress: number;
  completedToday: number;
  completedThisWeek: number;
  successRate: number;
  avgProcessingTime: number | null;
  pipelineStages: EnrichmentStage[];
  trendPoints: { date: string; pending: number; completed: number }[];
  trendsData: {
    pending: number[];
    completed: number[];
  };
}

interface SourcePerformanceResponse {
  sources: {
    sourceName: string;
    sourceType: string;
    totalHarvests: number;
    successfulHarvests: number;
    pendingHarvests: number;
    failedHarvests: number;
    successRate: number;
    trustScore: number;
    isActive: boolean;
    lastHarvestAt: string | null;
  }[];
  refreshedAt: string | null;
}

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const url = new URL(_args.request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const api = createLoaderApiClient();
  return {
    progress: await api.getApi<EnrichmentProgressResponse>(
      `/pim/stats/enrichment-progress${params.toString() ? `?${params.toString()}` : ''}`
    ),
    sourcePerformance: await api.getApi<SourcePerformanceResponse>('/pim/stats/source-performance'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

function parseRangeFromParams(searchParams: URLSearchParams): DateRange | undefined {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from && !to) return undefined;
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (fromDate && Number.isNaN(fromDate.getTime())) return undefined;
  if (toDate && Number.isNaN(toDate.getTime())) return undefined;
  return { from: fromDate, to: toDate };
}

export default function EnrichmentDashboardPage() {
  const { progress, sourcePerformance } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const stream = useEnrichmentStream();
  const api = useApiClient();
  const [starting, setStarting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const timeZone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const selectedRange = useMemo(() => parseRangeFromParams(searchParams), [searchParams]);
  const events: TimelineEvent[] = stream.events.flatMap((evt) => {
    const id = typeof evt.payload['id'] === 'string' ? evt.payload['id'] : null;
    const timestamp =
      typeof evt.payload['timestamp'] === 'string' ? evt.payload['timestamp'] : null;
    const eventType =
      typeof evt.payload['eventType'] === 'string' ? evt.payload['eventType'] : null;
    if (!id || !timestamp || !eventType) return [];
    const description =
      typeof evt.payload['triggerReason'] === 'string' ? evt.payload['triggerReason'] : undefined;
    const event: TimelineEvent = {
      id,
      timestamp,
      title: eventType,
      ...(description ? { description } : {}),
      status: evt.type === 'quality.event' ? 'info' : 'neutral',
      metadata: evt.payload,
    };
    return [event];
  });

  useEffect(() => {
    const id = setInterval(() => {
      void revalidator.revalidate();
    }, 120_000);
    return () => clearInterval(id);
  }, [revalidator]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          label="Interval date"
          value={selectedRange}
          timeZone={timeZone}
          onChange={(next) => {
            const params = new URLSearchParams(searchParams);
            const range = next ? toUtcIsoRange(next, timeZone) : null;
            if (range) {
              params.set('from', range.fromUtcIso);
              params.set('to', range.toUtcIso);
            } else {
              params.delete('from');
              params.delete('to');
            }
            setSearchParams(params, { replace: true });
          }}
        />
        <Button
          size="sm"
          onClick={() => {
            setStarting(true);
            void api
              .postApi<{ status: string; queued?: number }, { limit: number }>(
                '/pim/enrichment/start',
                {
                  limit: 50,
                }
              )
              .then((result) => {
                if (result.status === 'noop') {
                  toast.message('Nu exista produse eligibile pentru enrichment acum.');
                  return;
                }
                toast.success(
                  `Enrichment pornit${typeof result.queued === 'number' ? ` (${result.queued} produse)` : ''}.`
                );
                void revalidator.revalidate();
              })
              .catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Nu pot porni enrichment.');
              })
              .finally(() => setStarting(false));
          }}
          disabled={starting}
        >
          {starting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Porneste enrichment
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void revalidator.revalidate();
          }}
          disabled={revalidator.state === 'loading' || starting}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reincarca
        </Button>
        <DataFreshnessIndicator refreshedAt={sourcePerformance.refreshedAt} label="Date surse" />
      </div>

      <EnrichmentStatsCards
        stats={{
          pending: progress.pending,
          inProgress: progress.inProgress,
          completedToday: progress.completedToday,
          successRate: progress.successRate,
          trendsData: progress.trendsData,
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-muted/20 bg-background p-4">
            <div className="mb-2 text-xs text-muted">Pipeline stages</div>
            <EnrichmentPipelineViz stages={progress.pipelineStages} />
          </div>
          <EnrichmentProgressChart data={progress.trendPoints} />
          <SourcePerformanceTable rows={sourcePerformance.sources} />
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Activitate recenta</div>
          <Timeline events={events} maxHeight={420} emptyState="Nu exista evenimente inca." />
        </div>
      </div>
    </div>
  );
}
