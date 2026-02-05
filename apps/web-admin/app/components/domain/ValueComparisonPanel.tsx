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
      <div className="rounded-md border bg-muted/5 p-3 text-xs">
        <div className="text-[10px] font-semibold uppercase text-muted">Current</div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-foreground">{current}</pre>
      </div>
      <div
        className={`rounded-md border p-3 text-xs ${
          isDifferent ? 'border-amber-300 bg-amber-50/50' : 'bg-muted/5'
        }`}
      >
        <div className="text-[10px] font-semibold uppercase text-muted">Proposed</div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-foreground">{proposed}</pre>
      </div>
    </div>
  );
}
