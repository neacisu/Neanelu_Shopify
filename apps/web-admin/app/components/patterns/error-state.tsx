import { AlertTriangle } from 'lucide-react';

import { Button } from '../ui/button';

export function ErrorState({
  message,
  onRetry,
  errorCode,
}: {
  message: string;
  onRetry?: () => void;
  errorCode?: string | number;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50/80 p-4 shadow-[var(--shadow-sm)] dark:border-red-800/50 dark:bg-red-900/20"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/40">
          <AlertTriangle className="size-5 text-red-600 dark:text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-red-800 dark:text-red-200">{message}</div>
          {errorCode ? (
            <div className="mt-1 font-mono text-xs text-red-600/70 dark:text-red-400/70">
              Cod: {errorCode}
            </div>
          ) : null}
          {onRetry ? (
            <div className="mt-3">
              <Button variant="secondary" onClick={onRetry}>
                Reîncearcă
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
