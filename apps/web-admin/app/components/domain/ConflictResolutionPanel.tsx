type ConflictOption = Readonly<{
  label: string;
  value: string;
  weight: number;
  sourcesCount: number;
  trustAvg: number;
}>;

type ConflictResolutionPanelProps = Readonly<{
  attributeName: string;
  options: ConflictOption[];
  onSelect: (value: string) => void;
}>;

function percent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round(value * 100));
}

export function ConflictResolutionPanel({
  attributeName,
  options,
  onSelect,
}: ConflictResolutionPanelProps) {
  return (
    <div className="rounded-md border border-muted/20 bg-background p-3">
      <div className="text-sm font-semibold">Field: {attributeName}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {options.map((option) => (
          <div key={option.value} className="rounded-md border border-muted/20 p-3">
            <div className="text-sm font-medium">{option.label}</div>
            <div className="mt-1 text-xs text-muted">Value: {option.value}</div>
            <div className="mt-2 text-xs text-muted">
              Weight: {option.weight.toFixed(3)} • Sources: {option.sourcesCount} • Trust avg:{' '}
              {option.trustAvg.toFixed(2)}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted/10">
              <div
                className="h-2 rounded-full bg-primary/60"
                style={{ width: `${percent(option.weight)}%` }}
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-md border border-muted/20 px-3 py-1 text-xs"
              onClick={() => onSelect(option.value)}
            >
              Select winner
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
