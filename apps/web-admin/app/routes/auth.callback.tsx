import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Loader2 } from 'lucide-react';

import {
  buildShopifyAdminAppUrl,
  isValidShopDomain,
  ShopifyLink,
  useShopifyAppBridge,
  withShopifyQuery,
} from '../shopify';

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
    <div className="mx-auto max-w-xl space-y-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <div className="text-h5">{title}</div>
        <div className="text-body text-muted">{subtitle}</div>
      </div>

      {phase === 'loading' ? (
        <div className="inline-flex items-center gap-2 text-muted">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-caption">Se incarca…</span>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="space-y-2">
          <div className="rounded-md border border-error/30 bg-error/10 p-3 text-error">
            <div className="text-caption font-medium">Eroare</div>
            <div className="text-body text-foreground/90">
              {error ? `Cod: ${error}` : 'Nu am putut confirma instalarea.'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              className="rounded-md bg-primary px-3 py-2 text-caption text-primary-foreground hover:opacity-90"
              href={getRetryAuthUrl(shop)}
              rel="noreferrer"
            >
              Reîncearcă instalarea
            </a>

            {primaryCta ? (
              <a
                className="rounded-md border px-3 py-2 text-caption hover:bg-muted"
                href={primaryCta}
                target="_top"
                rel="noreferrer"
              >
                Deschide în Shopify Admin
              </a>
            ) : null}

            <ShopifyLink className="rounded-md border px-3 py-2 text-caption hover:bg-muted" to="/">
              Dashboard
            </ShopifyLink>
          </div>
        </div>
      ) : null}

      {phase === 'success' ? (
        <div className="flex items-center gap-3">
          <ShopifyLink
            className="rounded-md bg-primary px-3 py-2 text-caption text-primary-foreground"
            to="/"
          >
            Continuă
          </ShopifyLink>
          {primaryCta ? (
            <a
              className="rounded-md border px-3 py-2 text-caption hover:bg-muted"
              href={primaryCta}
              target="_top"
              rel="noreferrer"
            >
              Deschide în Shopify Admin
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
