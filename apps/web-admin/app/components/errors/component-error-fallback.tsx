import type { FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export function ComponentErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const fallbackMessage = 'Această secțiune nu a putut fi încărcată.';
  const message = error instanceof Error ? (error.message ?? fallbackMessage) : fallbackMessage;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 shadow-[var(--shadow-sm)] dark:border-red-800/50 dark:bg-red-900/20">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/40">
          <AlertTriangle className="size-5 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">
            Această secțiune nu a putut fi încărcată
          </div>
          <div className="mt-1 text-sm text-red-700/80 dark:text-red-300/80">{message}</div>
        </div>
      </div>
      <button
        type="button"
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-red-700 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(239,68,68,0.3)] dark:bg-red-500 dark:hover:bg-red-600"
        onClick={resetErrorBoundary}
        aria-label="Reîncearcă încărcarea secțiunii"
      >
        <RotateCcw className="size-4" />
        Reîncearcă
      </button>
    </div>
  );
}
