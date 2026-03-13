import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { format, formatDistanceToNow, isToday, isYesterday, startOfDay } from 'date-fns';

export type TimelineEvent = Readonly<{
  id: string;
  timestamp: Date | string | number;
  title: string;
  description?: string;
  icon?: ReactNode;
  status?: 'success' | 'error' | 'warning' | 'info' | 'neutral';
  metadata?: Record<string, unknown>;
  children?: ReactNode;
}>;

export type TimelineProps = Readonly<{
  events: readonly TimelineEvent[];
  orientation?: 'vertical' | 'horizontal';
  loading?: boolean;
  loadingState?: ReactNode;
  loadMore?: () => void | Promise<void>;
  hasMore?: boolean;
  showGroupHeaders?: boolean;
  relativeTime?: boolean;
  expandable?: boolean;
  maxHeight?: number | string;
  className?: string;
  emptyState?: ReactNode;
  timeFormat?: string;
  dateFormat?: string;
}>;

type ParsedEvent = Readonly<{
  event: TimelineEvent;
  date: Date;
  dayKey: string;
}>;

type GroupedEvents = Map<string, { label: string; events: ParsedEvent[] }>;

function parseTimestamp(ts: Date | string | number): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') return new Date(ts);
  return new Date(ts);
}

function getDayLabel(date: Date): string {
  if (isToday(date)) return 'Azi';
  if (isYesterday(date)) return 'Ieri';
  return format(date, 'EEEE, d MMMM yyyy');
}

function getDayKey(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

const statusDotColors: Record<string, string> = {
  success: 'bg-success ring-success/30',
  error: 'bg-error ring-error/30',
  warning: 'bg-warning ring-warning/30',
  info: 'bg-info ring-info/30',
  neutral: 'bg-card ring-border',
};

const statusTextColors: Record<string, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-foreground',
};

const defaultStatusIcons: Record<string, ReactNode> = {
  success: <CheckCircle2 className="size-4" />,
  error: <XCircle className="size-4" />,
  warning: <AlertTriangle className="size-4" />,
  info: <Info className="size-4" />,
};

function TimelineEventItem(props: {
  parsed: ParsedEvent;
  relativeTime: boolean;
  expandable: boolean;
  timeFormat: string;
  isLast: boolean;
}) {
  const { parsed, relativeTime, expandable, timeFormat, isLast } = props;
  const { event, date } = parsed;

  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const formattedTime = useMemo(() => {
    if (relativeTime) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return format(date, timeFormat);
  }, [date, relativeTime, timeFormat]);

  const status = event.status ?? 'neutral';
  const dotColor = statusDotColors[status] ?? statusDotColors['neutral'];
  const textColor = statusTextColors[status] ?? statusTextColors['neutral'];
  const statusIcon = event.icon ?? defaultStatusIcons[status];

  const hasExpandableContent =
    expandable && (event.description ?? event.metadata ?? event.children);

  const handleClick = useCallback(() => {
    if (hasExpandableContent) {
      setExpanded((prev) => !prev);
    }
  }, [hasExpandableContent]);

  const innerContent = (
    <>
      <div className="flex flex-col items-center">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full ring-2 transition-transform duration-200 ${dotColor} ${hovered ? 'scale-110' : ''}`}
          aria-hidden="true"
        >
          {statusIcon ? <span className="text-foreground">{statusIcon}</span> : null}
        </div>
        {!isLast ? <div className="w-px flex-1 bg-subtle" aria-hidden="true" /> : null}
      </div>

      <div className={`flex-1 pb-5 ${isLast ? 'pb-0' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {event.icon && !defaultStatusIcons[status] ? (
              <span className={`shrink-0 ${textColor}`}>{event.icon}</span>
            ) : null}
            <span className="text-sm font-medium text-foreground">{event.title}</span>
            {hasExpandableContent ? (
              <span
                className={`text-xs text-muted select-none transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted tabular-nums">{formattedTime}</span>
        </div>

        {!expandable && event.description ? (
          <p className="mt-1 text-sm text-muted">{event.description}</p>
        ) : null}

        {hasExpandableContent && expanded ? (
          <div className="mt-2 space-y-2 text-sm motion-safe:animate-[fadeSlideUp_0.15s_ease-out]">
            {event.description ? <p className="text-muted">{event.description}</p> : null}

            {event.metadata && Object.keys(event.metadata).length > 0 ? (
              <div className="rounded-lg border border-border bg-subtle p-2.5 text-xs">
                {Object.entries(event.metadata).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-mono text-muted">{key}:</span>
                    <span className="font-mono text-foreground">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {event.children}
          </div>
        ) : null}

        {hovered && !expanded && event.description && expandable ? (
          <p className="mt-1 text-xs text-muted/70 motion-safe:animate-[fadeIn_150ms_ease-out]">
            {event.description.length > 80
              ? `${event.description.slice(0, 80)}…`
              : event.description}
          </p>
        ) : null}
      </div>
    </>
  );

  return hasExpandableContent ? (
    <button
      type="button"
      className="relative flex w-full gap-3 text-left"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-expanded={expanded}
    >
      {innerContent}
    </button>
  ) : (
    <div className="relative flex gap-3">{innerContent}</div>
  );
}

export function Timeline(props: TimelineProps) {
  const {
    events,
    orientation = 'vertical',
    loading = false,
    loadingState,
    loadMore,
    hasMore = false,
    showGroupHeaders = true,
    relativeTime = true,
    expandable = true,
    maxHeight,
    className,
    emptyState,
    timeFormat = 'HH:mm',
  } = props;

  const parsedEvents = useMemo<ParsedEvent[]>(() => {
    return events
      .map((event) => {
        const date = parseTimestamp(event.timestamp);
        return {
          event,
          date,
          dayKey: getDayKey(date),
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [events]);

  const groupedEvents = useMemo<GroupedEvents>(() => {
    const groups: GroupedEvents = new Map();

    for (const parsed of parsedEvents) {
      const existing = groups.get(parsed.dayKey);
      if (existing) {
        existing.events.push(parsed);
      } else {
        groups.set(parsed.dayKey, {
          label: getDayLabel(parsed.date),
          events: [parsed],
        });
      }
    }

    return groups;
  }, [parsedEvents]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!loadMore || !hasMore || loading) return;

      const el = e.currentTarget;
      const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 100;

      if (nearEnd) {
        void loadMore();
      }
    },
    [hasMore, loadMore, loading]
  );

  if (loading && events.length === 0) {
    return (
      <div className={className} style={{ maxHeight, overflow: 'auto' }}>
        {loadingState ?? <div className="p-4 text-sm text-muted">Se încarcă cronologia…</div>}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={className} style={{ maxHeight, overflow: 'auto' }}>
        {emptyState ?? <div className="p-4 text-sm text-muted">Niciun eveniment de afișat.</div>}
      </div>
    );
  }

  if (orientation === 'horizontal') {
    return (
      <div
        className={`overflow-x-auto ${className ?? ''}`}
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        <div className="flex items-start gap-4 p-4">
          {parsedEvents.map((parsed) => {
            const status = parsed.event.status ?? 'neutral';
            const dotColor = statusDotColors[status];
            return (
              <div key={parsed.event.id} className="flex flex-col items-center min-w-35 max-w-50">
                <div
                  className={`flex size-6 items-center justify-center rounded-full ring-2 ${dotColor}`}
                >
                  {defaultStatusIcons[status] ? (
                    <span className="text-foreground text-[10px]">
                      {defaultStatusIcons[status]}
                    </span>
                  ) : null}
                </div>
                <div className="h-4 w-px bg-subtle" />
                <div className="text-center">
                  <div className="text-sm font-medium text-foreground">{parsed.event.title}</div>
                  <div className="text-xs text-muted">
                    {relativeTime
                      ? formatDistanceToNow(parsed.date, { addSuffix: true })
                      : format(parsed.date, timeFormat)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {loading && events.length > 0 ? (
          <div className="p-2 text-center text-sm text-muted">Se încarcă mai multe…</div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`overflow-auto ${className ?? ''}`}
      style={{ maxHeight }}
      onScroll={handleScroll}
      role="feed"
      aria-busy={loading}
    >
      <div className="p-4">
        {showGroupHeaders
          ? Array.from(groupedEvents.entries()).map(([dayKey, group]) => (
              <div key={dayKey} className="mb-4 last:mb-0">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </div>
                {group.events.map((parsed, index) => (
                  <TimelineEventItem
                    key={parsed.event.id}
                    parsed={parsed}
                    relativeTime={relativeTime}
                    expandable={expandable}
                    timeFormat={timeFormat}
                    isLast={index === group.events.length - 1}
                  />
                ))}
              </div>
            ))
          : parsedEvents.map((parsed, index) => (
              <TimelineEventItem
                key={parsed.event.id}
                parsed={parsed}
                relativeTime={relativeTime}
                expandable={expandable}
                timeFormat={timeFormat}
                isLast={index === parsedEvents.length - 1}
              />
            ))}
      </div>

      {loading && events.length > 0 ? (
        <div className="p-2 text-center text-sm text-muted">Se încarcă mai multe…</div>
      ) : null}
    </div>
  );
}
