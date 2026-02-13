import type { LoaderFunctionArgs } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useLoaderData, useRevalidator, useSearchParams } from 'react-router-dom';
import type { DateRange } from 'react-day-picker';
import { AlertCircle, Trophy, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { Timeline, type TimelineEvent } from '../components/ui/Timeline';
import { WebhookDeliveryStatusBadge } from '../components/domain/WebhookDeliveryStatusBadge';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { toUtcIsoRange } from '../utils/date-range';
import { useEnrichmentStream } from '../hooks/useEnrichmentStream';

interface QualityEvent {
  id: string;
  eventType: 'quality_promoted' | 'quality_demoted' | 'review_requested' | 'milestone_reached';
  productId: string;
  previousLevel?: string;
  newLevel?: string;
  qualityScore: number | null;
  triggerReason: string | null;
  webhookSent?: boolean;
  webhookSentAt?: string | null;
  webhookStatus?: 'sent' | 'pending' | 'retrying' | 'failed';
  webhookLastHttpStatus?: number | null;
  timestamp: string;
}

interface QualityEventsResponse {
  events: QualityEvent[];
  hasMore: boolean;
  totalCount: number;
}

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const url = new URL(_args.request.url);
  const params = new URLSearchParams();
  const type = url.searchParams.get('type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q');
  const limit = url.searchParams.get('limit');
  if (limit) params.set('limit', limit);
  if (type && type !== 'all') params.set('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q) params.set('q', q);
  const api = createLoaderApiClient();
  return {
    events: await api.getApi<QualityEventsResponse>(`/pim/events/quality?${params.toString()}`),
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

const eventIcon = (type: QualityEvent['eventType']) => {
  switch (type) {
    case 'quality_promoted':
      return <TrendingUp className="h-4 w-4" />;
    case 'quality_demoted':
      return <TrendingDown className="h-4 w-4" />;
    case 'review_requested':
      return <AlertCircle className="h-4 w-4" />;
    case 'milestone_reached':
      return <Trophy className="h-4 w-4" />;
    default:
      return null;
  }
};

function resolveWebhookBadgeStatus(
  status?: QualityEvent['webhookStatus'],
  sent?: boolean
): 'sent' | 'pending' | 'retrying' | 'failed' {
  if (status === 'sent' || status === 'pending' || status === 'retrying' || status === 'failed') {
    return status;
  }
  return sent ? 'sent' : 'pending';
}

export default function QualityEventsPage() {
  const { events } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const stream = useEnrichmentStream();
  const [searchParams, setSearchParams] = useSearchParams();
  const timeZone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const [eventType, setEventType] = useState(searchParams.get('type') ?? 'all');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [range, setRange] = useState<DateRange | undefined>(() =>
    parseRangeFromParams(searchParams)
  );
  const seenToastIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => {
      void revalidator.revalidate();
    }, 120_000);
    return () => clearInterval(id);
  }, [revalidator]);

  useEffect(() => {
    setEventType(searchParams.get('type') ?? 'all');
    setQuery(searchParams.get('q') ?? '');
    setRange(parseRangeFromParams(searchParams));
  }, [searchParams]);

  const streamEvents: QualityEvent[] = stream.events.flatMap((evt) => {
    if (evt.type !== 'quality.event') return [];
    const id = typeof evt.payload['id'] === 'string' ? evt.payload['id'] : null;
    const eventType =
      typeof evt.payload['eventType'] === 'string'
        ? (evt.payload['eventType'] as QualityEvent['eventType'])
        : null;
    const productId =
      typeof evt.payload['productId'] === 'string' ? evt.payload['productId'] : null;
    const timestamp =
      typeof evt.payload['timestamp'] === 'string' ? evt.payload['timestamp'] : null;
    if (!id || !eventType || !timestamp || !productId) return [];
    const previousLevel =
      typeof evt.payload['previousLevel'] === 'string' ? evt.payload['previousLevel'] : undefined;
    const newLevel =
      typeof evt.payload['newLevel'] === 'string' ? evt.payload['newLevel'] : undefined;
    const qualityScore =
      typeof evt.payload['qualityScore'] === 'number'
        ? evt.payload['qualityScore']
        : typeof evt.payload['qualityScore'] === 'string'
          ? Number(evt.payload['qualityScore'])
          : null;
    const triggerReason =
      typeof evt.payload['triggerReason'] === 'string' ? evt.payload['triggerReason'] : null;
    const webhookSent =
      typeof evt.payload['webhookSent'] === 'boolean' ? evt.payload['webhookSent'] : false;
    const webhookSentAt =
      typeof evt.payload['webhookSentAt'] === 'string' ? evt.payload['webhookSentAt'] : null;
    const webhookStatus =
      evt.payload['webhookStatus'] === 'sent' ||
      evt.payload['webhookStatus'] === 'pending' ||
      evt.payload['webhookStatus'] === 'retrying' ||
      evt.payload['webhookStatus'] === 'failed'
        ? evt.payload['webhookStatus']
        : 'pending';
    const webhookLastHttpStatus =
      typeof evt.payload['webhookLastHttpStatus'] === 'number'
        ? evt.payload['webhookLastHttpStatus']
        : null;
    const qualityEvent: QualityEvent = {
      id,
      eventType,
      productId,
      ...(previousLevel ? { previousLevel } : {}),
      ...(newLevel ? { newLevel } : {}),
      qualityScore,
      triggerReason,
      webhookSent,
      webhookSentAt,
      webhookStatus,
      webhookLastHttpStatus,
      timestamp,
    };
    return [qualityEvent];
  });

  const mergedEvents = [...streamEvents, ...events.events];

  useEffect(() => {
    for (const evt of stream.events) {
      if (evt.type !== 'quality.event') continue;
      const id = typeof evt.payload['id'] === 'string' ? evt.payload['id'] : null;
      if (!id || seenToastIds.current.has(id)) continue;
      seenToastIds.current.add(id);

      const eventType =
        typeof evt.payload['eventType'] === 'string'
          ? (evt.payload['eventType'] as QualityEvent['eventType'])
          : null;
      const newLevel = typeof evt.payload['newLevel'] === 'string' ? evt.payload['newLevel'] : '';

      if (eventType === 'quality_promoted') {
        toast.success(`Product promoted to ${newLevel}!`, {
          duration: 5000,
          icon: newLevel === 'golden' ? '🏆' : '⬆️',
        });
      }
      if (eventType === 'quality_demoted') {
        toast.warning(`Product demoted to ${newLevel}`, { duration: 5000 });
      }
    }
  }, [stream.events]);

  const timelineEvents: TimelineEvent[] = mergedEvents.map((evt) => {
    const description = evt.triggerReason ?? undefined;
    const badgeStatus = resolveWebhookBadgeStatus(evt.webhookStatus, evt.webhookSent);
    const webhookLabel =
      badgeStatus === 'sent'
        ? `Webhook sent${evt.webhookSentAt ? ` at ${new Date(evt.webhookSentAt).toLocaleString()}` : ''}`
        : badgeStatus === 'failed'
          ? `Webhook failed${evt.webhookLastHttpStatus ? ` (HTTP ${evt.webhookLastHttpStatus})` : ''}`
          : badgeStatus === 'retrying'
            ? 'Webhook retrying'
            : 'Webhook pending';
    return {
      id: evt.id,
      timestamp: evt.timestamp,
      title: evt.eventType,
      icon: (
        <span className="inline-flex items-center gap-2">
          <span>{eventIcon(evt.eventType)}</span>
          <WebhookDeliveryStatusBadge status={badgeStatus} title={webhookLabel} />
        </span>
      ),
      status: evt.eventType === 'quality_demoted' ? 'error' : 'success',
      metadata: {
        productId: evt.productId,
        previousLevel: evt.previousLevel,
        newLevel: evt.newLevel,
        qualityScore: evt.qualityScore ?? 'n/a',
        webhookStatus: webhookLabel,
      },
      description: `${description ? `${description} · ` : ''}${webhookLabel}`,
    };
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="grid gap-3 lg:grid-cols-[200px_1fr_1fr_auto]">
          <div>
            <label className="text-caption text-muted">Event type</label>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={eventType}
              onChange={(e) => setEventType((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All</option>
              <option value="quality_promoted">Promoted</option>
              <option value="quality_demoted">Demoted</option>
              <option value="review_requested">Review requested</option>
              <option value="milestone_reached">Milestone</option>
            </select>
          </div>
          <div>
            <label className="text-caption text-muted">Product search</label>
            <input
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Product ID"
              value={query}
              onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>
          <DateRangePicker
            label="Date range"
            value={range}
            timeZone={timeZone}
            onChange={(next) => setRange(next)}
          />
          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                if (eventType && eventType !== 'all') params.set('type', eventType);
                else params.delete('type');
                if (query.trim()) params.set('q', query.trim());
                else params.delete('q');
                const isoRange = range ? toUtcIsoRange(range, timeZone) : null;
                if (isoRange) {
                  params.set('from', isoRange.fromUtcIso);
                  params.set('to', isoRange.toUtcIso);
                } else {
                  params.delete('from');
                  params.delete('to');
                }
                setSearchParams(params, { replace: true });
              }}
            >
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEventType('all');
                setQuery('');
                setRange(undefined);
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <Timeline events={timelineEvents} maxHeight={640} />
      </div>
    </div>
  );
}
