import { AlertTriangle } from 'lucide-react';

import { Button } from '../ui/button.js';

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
      className="rounded-xl border border-error/30 bg-error/5 p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-error/10">
          <AlertTriangle className="size-5 text-error" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-error">{message}</div>
          {errorCode ? (
            <div className="mt-1 font-mono text-xs text-error/70">Cod: {errorCode}</div>
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
