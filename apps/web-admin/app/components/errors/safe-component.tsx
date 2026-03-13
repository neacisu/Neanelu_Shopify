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
  fallback?: ((resetErrorBoundary: () => void) => ReactNode) | ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => {
        if (typeof fallback === 'function') {
          return fallback(resetErrorBoundary) as React.ReactElement;
        }
        if (fallback != null) {
          return fallback as React.ReactElement;
        }
        return <ComponentErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />;
      }}
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
