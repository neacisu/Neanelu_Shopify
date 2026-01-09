import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { isValidShopDomain } from '../shopify/shopify-url';

function normalizeReturnTo(raw: string | null): string {
  if (!raw) return '/app/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/app')) return '/app/';
  if (trimmed.startsWith('//')) return '/app/';
  if (trimmed.includes('://')) return '/app/';
  return trimmed;
}

export default function AuthRequiredPage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const returnTo = useMemo(() => normalizeReturnTo(params.get('returnTo')), [params]);

  const [shop, setShop] = useState(() => {
    try {
      return window.localStorage.getItem('neanelu_last_shop') ?? '';
    } catch {
      return '';
    }
  });

  const shopOk = shop.length > 0 && isValidShopDomain(shop);

  const startAuth = () => {
    if (!shopOk) return;

    try {
      window.localStorage.setItem('neanelu_last_shop', shop);
    } catch {
      // ignore
    }

    const url = new URL('/auth', window.location.origin);
    url.searchParams.set('shop', shop);
    url.searchParams.set('returnTo', returnTo);
    window.location.assign(url.toString());
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <div className="text-h5">Autentificare necesară</div>
        <div className="text-body text-muted">
          Nu am putut determina magazinul Shopify (lipsește parametrul{' '}
          <span className="font-medium">shop</span> din URL), deci nu putem crea sesiunea pentru
          API.
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-caption font-medium" htmlFor="shop">
          Domeniu shop (ex: <span className="font-mono">magazin.myshopify.com</span>)
        </label>
        <input
          id="shop"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-body"
          placeholder="your-shop.myshopify.com"
          autoComplete="off"
          spellCheck={false}
        />
        {!shopOk && shop.length > 0 ? (
          <div className="text-caption text-error">Domeniu invalid.</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startAuth}
          disabled={!shopOk}
          className="rounded-md bg-primary px-3 py-2 text-caption text-primary-foreground disabled:opacity-50"
        >
          Pornește autentificarea
        </button>

        <a
          className="rounded-md border px-3 py-2 text-caption hover:bg-muted"
          href={returnTo}
          rel="noreferrer"
        >
          Înapoi
        </a>
      </div>

      <div className="text-caption text-muted">
        Tip: cel mai sigur e să deschizi aplicația din Shopify Admin (URL-ul va conține automat{' '}
        <span className="font-medium">shop</span> și
        <span className="font-medium">host</span>).
      </div>
    </div>
  );
}
