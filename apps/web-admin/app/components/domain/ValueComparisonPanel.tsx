type ValueComparisonPanelProps = Readonly<{
  currentValue: unknown;
  proposedValue: unknown;
}>;

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function ValueComparisonPanel({ currentValue, proposedValue }: ValueComparisonPanelProps) {
  const current = formatValue(currentValue);
  const proposed = formatValue(proposedValue);
  const isDifferent = current !== proposed;

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="rounded-md border bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
        <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
          Actual
        </div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">
          {current}
        </pre>
      </div>
      <div
        className={`rounded-md border p-3 text-xs ${
          isDifferent
            ? 'border-amber-300 bg-amber-50/50 dark:border-amber-600/50 dark:bg-amber-900/20'
            : 'bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
        }`}
      >
        <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
          Propus
        </div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">
          {proposed}
        </pre>
      </div>
    </div>
  );
}
