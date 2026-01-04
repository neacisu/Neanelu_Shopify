import { useEffect } from 'react';
import { isRouteErrorResponse, Outlet, useRouteError } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import './globals.css';

function GlobalSpinner() {
  return (
    <div className="inline-flex items-center gap-2 text-muted">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-caption">Loading…</span>
    </div>
  );
}

function ErrorAlert({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
      <div className="text-h6">{title}</div>
      <div className="mt-2 text-body text-foreground/90">{message}</div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorAlert
        title={`Eroare ${error.status}`}
        message={error.statusText || 'A apărut o eroare neașteptată.'}
      />
    );
  }

  const message =
    error instanceof Error ? error.message : 'UI a întâmpinat o problemă neașteptată.';
  return <ErrorAlert title="A apărut o eroare" message={message} />;
}

export default function Root() {
  useEffect(() => {
    if (!document.querySelector('script[data-neanelu-polaris="1"]')) {
      const script = document.createElement('script');
      script.src = 'https://cdn.shopify.com/shopifycloud/polaris.js';
      script.async = true;
      script.dataset['neaneluPolaris'] = '1';
      document.head.appendChild(script);
    }

    toast('Web Admin loaded');
  }, []);

  return (
    <div className="min-h-screen">
      <Toaster richColors />
      <div className="p-4">
        <div className="mb-4 hidden">
          <GlobalSpinner />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
