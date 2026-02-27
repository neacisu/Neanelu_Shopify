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
    <div className="rounded-md border border-muted/20 bg-white/80 backdrop-blur-sm p-3 dark:bg-slate-900/80 dark:border-slate-700/60">
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Câmp: {attributeName}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {options.map((option) => (
          <div
            key={option.value}
            className="rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50"
          >
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {option.label}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Valoare: {option.value}
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Pondere: {option.weight.toFixed(3)} • Surse: {option.sourcesCount} • Trust mediu:{' '}
              {option.trustAvg.toFixed(2)}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted/10 dark:bg-slate-700">
              <div
                className="h-2 rounded-full bg-primary/60"
                style={{ width: `${percent(option.weight)}%` }}
              />
            </div>
            <button
              type="button"
              className="mt-3 rounded-md border border-muted/20 px-3 py-1 text-xs transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => onSelect(option.value)}
            >
              Selectează câștigător
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
