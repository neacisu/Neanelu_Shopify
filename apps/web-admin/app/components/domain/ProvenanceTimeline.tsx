import { Timeline, type TimelineEvent } from '../ui/Timeline';

type ProvenanceEntry = Readonly<{
  attributeName: string;
  sourceName: string;
  resolvedAt: string;
}>;

type ProvenanceTimelineProps = Readonly<{
  entries: readonly ProvenanceEntry[];
}>;

export function ProvenanceTimeline({ entries }: ProvenanceTimelineProps) {
  const events: TimelineEvent[] = entries.map((entry, idx) => ({
    id: `${entry.attributeName}-${idx}`,
    timestamp: entry.resolvedAt,
    title: entry.attributeName,
    description: `Sursă: ${entry.sourceName}`,
    status: 'info',
  }));

  return <Timeline events={events} />;
}
