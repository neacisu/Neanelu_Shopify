type QualityBreakdown = Readonly<{
  completeness: number;
  accuracy: number;
  consistency: number;
  sourceWeight: number;
}>;

type QualityScoreBreakdownProps = Readonly<{
  breakdown: QualityBreakdown | null | undefined;
  score?: number | null;
}>;

function toPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function QualityScoreBreakdown({ breakdown, score }: QualityScoreBreakdownProps) {
  if (!breakdown) {
    return <div className="text-xs text-muted">Nu există detaliere calitate disponibilă.</div>;
  }

  const items: { label: string; value: number }[] = [
    { label: 'Completitudine', value: breakdown.completeness },
    { label: 'Acuratețe', value: breakdown.accuracy },
    { label: 'Consistență', value: breakdown.consistency },
    { label: 'Pondere surse', value: breakdown.sourceWeight },
  ];

  return (
    <div className="space-y-3">
      {typeof score === 'number' ? (
        <div className="text-xs text-muted">Scor calitate: {toPercent(score)}%</div>
      ) : null}
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{item.label}</span>
            <span>{toPercent(item.value)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/10">
            <div
              className="h-2 rounded-full bg-primary/60"
              style={{ width: `${toPercent(item.value)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
