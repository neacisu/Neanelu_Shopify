import type { FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export function ComponentErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const fallbackMessage = 'Această secțiune nu a putut fi încărcată.';
  const message = error instanceof Error ? (error.message ?? fallbackMessage) : fallbackMessage;

  return (
    <div className="rounded-xl border border-error/30 bg-error/5 p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-error/10">
          <AlertTriangle className="size-5 text-error" />
        </div>
        <div>
          <div className="text-sm font-semibold text-error">
            Această secțiune nu a putut fi încărcată
          </div>
          <div className="mt-1 text-sm text-error/80">{message}</div>
        </div>
      </div>
      <button
        type="button"
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-error focus-ring-standard"
        onClick={resetErrorBoundary}
        aria-label="Reîncearcă încărcarea secțiunii"
      >
        <RotateCcw className="size-4" />
        Reîncearcă
      </button>
    </div>
  );
}
