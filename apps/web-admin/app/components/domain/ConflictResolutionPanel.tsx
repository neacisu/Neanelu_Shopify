import { Button } from '../ui/button';

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
    <div className="rounded-md border border-muted/20 bg-card/80 backdrop-blur-sm p-3">
      <div className="text-sm font-semibold text-foreground">Câmp: {attributeName}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {options.map((option) => (
          <div key={option.value} className="rounded-md border border-muted/20 p-3">
            <div className="text-sm font-medium text-foreground">{option.label}</div>
            <div className="mt-1 text-xs text-muted">Valoare: {option.value}</div>
            <div className="mt-2 text-xs text-muted">
              Pondere: {option.weight.toFixed(3)} • Surse: {option.sourcesCount} • Trust mediu:{' '}
              {option.trustAvg.toFixed(2)}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted/10">
              <div
                className="h-2 rounded-full bg-primary/60 transition-[width] duration-500"
                style={{ width: `${percent(option.weight)}%` }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => onSelect(option.value)}
            >
              Selectează câștigător
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
