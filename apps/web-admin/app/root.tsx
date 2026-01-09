import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { isRouteErrorResponse, Outlet, useMatches, useRouteError } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import './globals.css';
import { AppShell } from './components/layout/app-shell';
import { OfflinePage, RouteErrorPage } from './components/errors/error-pages';
import { useOnlineStatus } from './hooks/use-online-status';
import {
  MissingHostPage,
  SessionTokenUx,
  ShopifyAppBridgeProvider,
  ShopifyLink,
  useShopifyAppBridge,
  useShopifyTitleBar,
} from './shopify';

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
      <ShopifyLink className="text-caption text-primary hover:underline" to="/">
        Înapoi la Dashboard
      </ShopifyLink>
    </div>
  );
}

function useRouteTitle(): string {
  const matches = useMatches();
  const titleMatch = [...matches]
    .reverse()
    .find((match) => typeof (match.handle as { title?: unknown } | undefined)?.title === 'string');

  return (titleMatch?.handle as { title?: string } | undefined)?.title ?? 'Web Admin';
}

function EmbeddedGate({ children }: { children: ReactNode }) {
  const matches = useMatches();
  const { missingHost, apiKey, shop } = useShopifyAppBridge();

  const skipEmbeddedGate = [...matches].some(
    (match) =>
      (match.handle as { skipEmbeddedGate?: unknown } | undefined)?.skipEmbeddedGate === true
  );

  if (skipEmbeddedGate) {
    return children;
  }

  if (missingHost) {
    return <MissingHostPage {...(apiKey ? { apiKey } : {})} shop={shop} />;
  }

  return children;
}

export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="inline-flex items-center gap-2 text-muted">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-body font-medium">Loading application...</span>
      </div>
    </div>
  );
}

export default function Root() {
  const isOnline = useOnlineStatus();
  const title = useRouteTitle();

  useShopifyTitleBar(title);

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

  useEffect(() => {
    document.title = `${title} · Neanelu`;
  }, [title]);

  return (
    <div className="min-h-screen">
      <Toaster richColors />
      <ShopifyAppBridgeProvider>
        <SessionTokenUx />
        <AppShell>
          <div className="mb-4 hidden">
            <GlobalSpinner />
          </div>
          <EmbeddedGate>{isOnline ? <Outlet /> : <OfflinePage />}</EmbeddedGate>
        </AppShell>
      </ShopifyAppBridgeProvider>
    </div>
  );
}
