import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { TextField } from '../components/ui/text-field';
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
    <Card variant="glass" padding="lg" className="mx-auto max-w-xl">
      <CardHeader className="space-y-1 border-b-0 pb-0">
        <div className="text-h5">Autentificare necesară</div>
        <div className="text-body text-muted">
          Nu am putut determina magazinul Shopify (lipsește parametrul{' '}
          <span className="font-medium">shop</span> din URL), deci nu putem crea sesiunea pentru
          API.
        </div>
      </CardHeader>

      <CardContent className="mt-6">
        <TextField
          id="shop"
          label="Domeniu shop (ex: magazin.myshopify.com)"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="your-shop.myshopify.com"
          autoComplete="off"
          spellCheck={false}
          {...(!shopOk && shop.length > 0 ? { error: 'Domeniu invalid.' } : {})}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={startAuth} disabled={!shopOk}>
            Pornește autentificarea
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              window.location.href = returnTo;
            }}
          >
            Înapoi
          </Button>
        </div>

        <div className="text-caption text-muted">
          Tip: cel mai sigur e să deschizi aplicația din Shopify Admin (URL-ul va conține automat{' '}
          <span className="font-medium">shop</span> și
          <span className="font-medium">host</span>).
        </div>
      </CardContent>
    </Card>
  );
}
