import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { format, formatDistanceToNow, isToday, isYesterday, startOfDay } from 'date-fns';

/**
 * A single event in the timeline.
 */
export type TimelineEvent = Readonly<{
  /** Unique identifier for the event. */
  id: string;

  /** Event timestamp (Date object, ISO string, or epoch ms). */
  timestamp: Date | string | number;

  /** Event title / headline. */
  title: string;

  /** Optional longer description. */
  description?: string;

  /** Optional icon to display alongside the event. */
  icon?: ReactNode;

  /** Visual status indicator. */
  status?: 'success' | 'error' | 'warning' | 'info' | 'neutral';

  /** Any additional metadata to display. */
  metadata?: Record<string, unknown>;

  /** Optional custom content to render inside the event item. */
  children?: ReactNode;
}>;

export type TimelineProps = Readonly<{
  /** The list of timeline events to display. */
  events: readonly TimelineEvent[];

  /** Orientation of the timeline. Defaults to 'vertical'. */
  orientation?: 'vertical' | 'horizontal';

  /** Whether to show loading state. */
  loading?: boolean;

  /** Custom loading element. */
  loadingState?: ReactNode;

  /** Callback for loading more events (infinite scroll). */
  loadMore?: () => void | Promise<void>;

  /** Whether more events can be loaded. */
  hasMore?: boolean;

  /** Whether to group events by day with date headers. */
  showGroupHeaders?: boolean;

  /** Whether to show relative time (e.g. "2 hours ago"). */
  relativeTime?: boolean;

  /** Whether event details are expandable on click. */
  expandable?: boolean;

  /** Maximum height for the timeline container. */
  maxHeight?: number | string;

  /** Additional CSS class names. */
  className?: string;

  /** Empty state when no events are provided. */
  emptyState?: ReactNode;

  /** Time format for absolute timestamps. Defaults to 'HH:mm'. */
  timeFormat?: string;

  /** Date format for group headers. Defaults to 'EEEE, MMMM d, yyyy'. */
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
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d, yyyy');
}

function getDayKey(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

const statusColors: Record<string, string> = {
  success: 'bg-emerald-500 border-emerald-600',
  error: 'bg-red-500 border-red-600',
  warning: 'bg-amber-500 border-amber-600',
  info: 'bg-blue-500 border-blue-600',
  neutral: 'bg-gray-400 border-gray-500',
};

const statusTextColors: Record<string, string> = {
  success: 'text-emerald-700 dark:text-emerald-400',
  error: 'text-red-700 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-blue-700 dark:text-blue-400',
  neutral: 'text-gray-600 dark:text-gray-400',
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

  const formattedTime = useMemo(() => {
    if (relativeTime) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return format(date, timeFormat);
  }, [date, relativeTime, timeFormat]);

  const status = event.status ?? 'neutral';
  const dotColor = statusColors[status] ?? statusColors['neutral'];
  const textColor = statusTextColors[status] ?? statusTextColors['neutral'];

  const hasExpandableContent =
    expandable && (event.description ?? event.metadata ?? event.children);

  const handleClick = useCallback(() => {
    if (hasExpandableContent) {
      setExpanded((prev) => !prev);
    }
  }, [hasExpandableContent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (hasExpandableContent && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setExpanded((prev) => !prev);
      }
    },
    [hasExpandableContent]
  );

  return (
    <div
      className={`relative flex gap-3 ${hasExpandableContent ? 'cursor-pointer' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={hasExpandableContent ? 'button' : undefined}
      tabIndex={hasExpandableContent ? 0 : undefined}
      aria-expanded={hasExpandableContent ? expanded : undefined}
    >
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className={`h-3 w-3 shrink-0 rounded-full border-2 ${dotColor}`} aria-hidden="true" />
        {!isLast ? (
          <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        ) : null}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-4 ${isLast ? 'pb-0' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {event.icon ? <span className={`shrink-0 ${textColor}`}>{event.icon}</span> : null}
            <span className="font-medium text-sm">{event.title}</span>
            {hasExpandableContent ? (
              <span className="text-xs text-muted select-none">{expanded ? '▼' : '▶'}</span>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted tabular-nums">{formattedTime}</span>
        </div>

        {/* Expandable content */}
        {hasExpandableContent && expanded ? (
          <div className="mt-2 space-y-2 text-sm">
            {event.description ? <p className="text-muted">{event.description}</p> : null}

            {event.metadata && Object.keys(event.metadata).length > 0 ? (
              <div className="rounded-md border bg-muted/10 p-2 text-xs">
                {Object.entries(event.metadata).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-mono text-muted">{key}:</span>
                    <span className="font-mono">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {event.children}
          </div>
        ) : null}

        {/* Non-expandable description (always visible) */}
        {!expandable && event.description ? (
          <p className="mt-1 text-sm text-muted">{event.description}</p>
        ) : null}
      </div>
    </div>
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
    // dateFormat prop available for future customization
  } = props;

  // Parse and sort events by timestamp (most recent first)
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

  // Group events by day
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

  // Loading state
  if (loading && events.length === 0) {
    return (
      <div className={className} style={{ maxHeight, overflow: 'auto' }}>
        {loadingState ?? <div className="p-4 text-sm text-muted">Loading timeline…</div>}
      </div>
    );
  }

  // Empty state
  if (events.length === 0) {
    return (
      <div className={className} style={{ maxHeight, overflow: 'auto' }}>
        {emptyState ?? <div className="p-4 text-sm text-muted">No events to display.</div>}
      </div>
    );
  }

  // Horizontal orientation
  if (orientation === 'horizontal') {
    return (
      <div
        className={`overflow-x-auto ${className ?? ''}`}
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        <div className="flex items-start gap-4 p-4">
          {parsedEvents.map((parsed) => (
            <div
              key={parsed.event.id}
              className="flex flex-col items-center min-w-[140px] max-w-[200px]"
            >
              <div
                className={`h-3 w-3 rounded-full border-2 ${
                  statusColors[parsed.event.status ?? 'neutral']
                }`}
              />
              <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
              <div className="text-center">
                <div className="font-medium text-sm">{parsed.event.title}</div>
                <div className="text-xs text-muted">
                  {relativeTime
                    ? formatDistanceToNow(parsed.date, { addSuffix: true })
                    : format(parsed.date, timeFormat)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {loading && events.length > 0 ? (
          <div className="p-2 text-sm text-muted text-center">Loading more…</div>
        ) : null}
      </div>
    );
  }

  // Vertical orientation (default)
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
          ? // Grouped by day
            Array.from(groupedEvents.entries()).map(([dayKey, group]) => (
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
          : // Flat list without grouping
            parsedEvents.map((parsed, index) => (
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
        <div className="p-2 text-sm text-muted text-center">Loading more…</div>
      ) : null}
    </div>
  );
}
