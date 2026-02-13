import type { FallbackProps } from 'react-error-boundary';

export function ComponentErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  // Intentionally minimal: no stack traces in UI.
  const fallbackMessage = 'Această secțiune nu a putut fi încărcată.';
  const message = error instanceof Error ? (error.message ?? fallbackMessage) : fallbackMessage;

  return (
    <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
      <div className="text-h6">Această secțiune nu a putut fi încărcată</div>
      <div className="mt-2 text-body text-foreground/90">{message}</div>
      <button
        type="button"
        className="mt-4 rounded-md bg-error px-4 py-2 text-body text-background shadow-sm hover:bg-error/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
        onClick={resetErrorBoundary}
      >
        Reîncearcă
      </button>
    </div>
  );
}
