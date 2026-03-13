import { useRef } from 'react';
import { Timeline, type TimelineEvent } from '../ui/Timeline';
import { InfoTooltip } from '../ui/info-tooltip';

type ProvenanceEntry = Readonly<{
  attributeName: string;
  sourceName: string;
  resolvedAt: string;
}>;

type ProvenanceTimelineProps = Readonly<{
  entries: readonly ProvenanceEntry[];
}>;

function getProvenanceDescription(entry: ProvenanceEntry): string {
  return `Valoarea provine din sursa „${entry.sourceName}". Această sursă a furnizat informația la momentul rezolvării.`;
}

export function ProvenanceTimeline({ entries }: ProvenanceTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const events: TimelineEvent[] = entries.map((entry, idx) => ({
    id: `${entry.attributeName}-${idx}`,
    timestamp: entry.resolvedAt,
    title: entry.attributeName,
    description: getProvenanceDescription(entry),
    status: 'info',
    metadata: { sursă: entry.sourceName },
  }));

  return (
    <div ref={containerRef} className="motion-safe:animate-[fadeSlideUp_0.35s_ease-out]">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          Istoric surse
        </span>
        <InfoTooltip
          title="Cum se completează datele"
          side="bottom"
          maxWidth={400}
          boundaryRef={containerRef}
        >
          Fiecare linie arată de unde provine valoarea pentru un atribut (ex. titlu, preț). Sursa
          poate fi magazinul tău, o potrivire confirmată sau o extracție automată. Ordinea reflectă
          când a fost rezolvată fiecare sursă.
        </InfoTooltip>
      </div>
      <div className="rounded-lg border border-muted/20 bg-card/50 p-3">
        <Timeline
          events={events}
          showGroupHeaders={true}
          relativeTime={true}
          expandable={true}
          emptyState={
            <p className="py-4 text-center text-sm text-muted">
              Niciun eveniment de proveniență de afișat.
            </p>
          }
        />
      </div>
    </div>
  );
}
