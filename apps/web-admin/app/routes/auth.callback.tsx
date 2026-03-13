import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  buildShopifyAdminAppUrl,
  isValidShopDomain,
  ShopifyLink,
  useShopifyAppBridge,
  withShopifyQuery,
} from '../shopify';
import { ErrorState } from '../components/patterns/error-state.js';
import { LoadingState } from '../components/patterns/loading-state.js';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';

const ALLOWED_ERROR_CODES = new Set([
  'INVALID_CALLBACK',
  'INVALID_SHOP',
  'INVALID_HMAC',
  'INVALID_STATE',
  'STATE_ALREADY_USED',
  'STATE_EXPIRED',
  'TOKEN_EXCHANGE_FAILED',
  'SAVE_FAILED',
  'INTERNAL_ERROR',
]);

function getSafeErrorCode(raw: string | null): string | null {
  if (!raw) return null;
  if (!ALLOWED_ERROR_CODES.has(raw)) return 'INTERNAL_ERROR';
  return raw;
}

function getRetryAuthUrl(shop: string | null): string {
  const url = new URL('/auth', window.location.origin);
  if (shop && isValidShopDomain(shop)) url.searchParams.set('shop', shop);
  return url.toString();
}

function redirectTop(url: string) {
  // Prefer top-level navigation; Shopify embedded flows often require escaping the iframe.
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.assign(url);
      return;
    }
  } catch {
    // ignore
  }

  window.location.assign(url);
}

export default function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { apiKey } = useShopifyAppBridge();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const shop = params.get('shop');
  const result = params.get('result');
  const error = getSafeErrorCode(params.get('error'));

  const hasSensitiveParams =
    params.has('code') || params.has('state') || params.has('hmac') || params.has('timestamp');

  const [phase, setPhase] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    // Defensive: if someone points Shopify Redirect URL to /app/auth/callback,
    // forward to the server callback endpoint and scrub the current URL.
    if (!hasSensitiveParams) return;

    const originalSearch = location.search;

    // Best-effort scrub (avoid query lingering in address bar / screenshots).
    try {
      window.history.replaceState({}, '', '/app/auth/callback');
    } catch {
      // ignore
    }

    const url = new URL('/auth/callback', window.location.origin);
    url.search = originalSearch;

    redirectTop(url.toString());
  }, [hasSensitiveParams, location.search]);

  useEffect(() => {
    if (hasSensitiveParams) return;

    if (result === 'ok') {
      setPhase('success');
      const timer = setTimeout(() => {
        void navigate(withShopifyQuery('/', location.search));
      }, 750);
      return () => clearTimeout(timer);
    }

    if (error) {
      setPhase('error');
      return;
    }

    // Default: show a short loading state; if nothing meaningful arrives, show error.
    const timer = setTimeout(() => setPhase('error'), 1200);
    return () => clearTimeout(timer);
  }, [error, hasSensitiveParams, location.search, navigate, result]);

  const primaryCta = useMemo(() => {
    if (!shop || !apiKey || !isValidShopDomain(shop)) return null;
    return buildShopifyAdminAppUrl(shop, apiKey);
  }, [apiKey, shop]);

  const title =
    phase === 'success'
      ? 'Instalare finalizată'
      : phase === 'error'
        ? 'Autentificare eșuată'
        : 'Finalizăm instalarea…';

  const subtitle =
    phase === 'success'
      ? 'Te redirecționăm către aplicație.'
      : phase === 'error'
        ? 'Poți reîncerca instalarea sau deschide aplicația din Shopify Admin.'
        : 'Te rugăm să aștepți câteva secunde.';

  return (
    <Card variant="glass" padding="lg" className="mx-auto max-w-xl">
      <CardHeader className="space-y-1 border-b-0 pb-0">
        <div className="text-h5">{title}</div>
        <div className="text-body text-muted">{subtitle}</div>
      </CardHeader>

      <CardContent className="mt-6">
        {phase === 'loading' ? <LoadingState label="Se incarcă…" /> : null}

        {phase === 'error' ? (
          <div className="space-y-2">
            <ErrorState
              message="Nu am putut confirma instalarea."
              {...(error ? { errorCode: error } : {})}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() => {
                  window.location.href = getRetryAuthUrl(shop);
                }}
              >
                Reîncearcă instalarea
              </Button>

              {primaryCta ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.open(primaryCta, '_top');
                  }}
                >
                  Deschide în Shopify Admin
                </Button>
              ) : null}

              <ShopifyLink
                className="group relative inline-flex h-9 items-center justify-center overflow-hidden whitespace-nowrap rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] transition-all duration-normal ease-out-enterprise focus-ring-standard hover:-translate-y-0.5 hover:border-accent-border hover:bg-subtle/60 hover:shadow-[var(--shadow-md)] active:translate-y-0"
                to="/"
              >
                Dashboard
              </ShopifyLink>
            </div>
          </div>
        ) : null}

        {phase === 'success' ? (
          <div className="flex items-center gap-3">
            <ShopifyLink
              className="group relative inline-flex h-9 items-center justify-center overflow-hidden whitespace-nowrap rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-all duration-normal ease-out-enterprise focus-ring-standard hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[var(--shadow-md)] active:translate-y-0"
              to="/"
            >
              Continuă
            </ShopifyLink>
            {primaryCta ? (
              <Button
                variant="secondary"
                onClick={() => {
                  window.open(primaryCta, '_top');
                }}
              >
                Deschide în Shopify Admin
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
