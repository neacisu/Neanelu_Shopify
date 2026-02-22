import type { ErrorInfo, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { reportUiError } from '../../utils/report-ui-error';
import { ComponentErrorFallback } from './component-error-fallback';

export function SafeComponent({
  children,
  fallback,
  onError,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) =>
        fallback ?? <ComponentErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />
      }
      onError={(error, info) => {
        const err = error instanceof Error ? error : new Error(String(error));
        reportUiError(err, { source: 'component' });
        onError?.(err, info);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
