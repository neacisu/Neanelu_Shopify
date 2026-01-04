import { useEffect } from 'react';
import { isRouteErrorResponse, Link, Outlet, useRouteError } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import './globals.css';
import { AppShell } from './components/layout/app-shell';
import { OfflinePage, RouteErrorPage } from './components/errors/error-pages';
import { useOnlineStatus } from './hooks/use-online-status';

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
    return <RouteErrorPage status={error.status} statusText={error.statusText} />;
  }

  const message =
    error instanceof Error ? error.message : 'UI a întâmpinat o problemă neașteptată.';
  return (
    <div className="space-y-4">
      <RouteErrorPage status={500} statusText="Internal Error" />
      <ErrorAlert title="Detalii" message={message} />
      <Link className="text-caption text-primary hover:underline" to="/">
        Înapoi la Dashboard
      </Link>
    </div>
  );
}

export default function Root() {
  const isOnline = useOnlineStatus();

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
      <AppShell>
        <div className="mb-4 hidden">
          <GlobalSpinner />
        </div>
        {isOnline ? <Outlet /> : <OfflinePage />}
      </AppShell>
    </div>
  );
}
