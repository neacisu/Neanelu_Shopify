import { useEffect, useMemo, useState } from 'react';

import { useUiProfile } from '../../hooks/use-ui-profile';
import { isValidShopDomain, useShopifyAppBridge } from '../../shopify';

function buildAuthUrl(shopDomain: string): string {
  const url = new URL('/auth', window.location.origin);
  url.searchParams.set('shop', shopDomain);
  return url.toString();
}

export function ShopSelector() {
  const { isEmbedded, shop } = useShopifyAppBridge();
  const { profile, loading, update } = useUiProfile();

  const defaultShop = useMemo(() => {
    return shop ?? profile.activeShopDomain ?? profile.lastShopDomain ?? '';
  }, [profile.activeShopDomain, profile.lastShopDomain, shop]);

  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(defaultShop);
  }, [defaultShop]);

  if (isEmbedded) {
    return (
      <div className="min-w-0 text-caption text-muted">
        <div className="flex items-center gap-2">
          <span className="text-foreground/80">Shop</span>
          <span className="truncate text-foreground">{shop ?? '—'}</span>
        </div>
      </div>
    );
  }

  const normalized = draft.trim();
  const valid = normalized.length > 0 && isValidShopDomain(normalized);

  return (
    <div className="min-w-0 text-caption text-muted">
      <label className="sr-only" htmlFor="shop-selector">
        Shop
      </label>
      <div className="flex items-center gap-2">
        <span className="text-foreground/80">Shop</span>
        <input
          id="shop-selector"
          value={draft}
          disabled={loading}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = draft.trim();
            if (!v || !isValidShopDomain(v)) return;
            void update({ lastShopDomain: v, activeShopDomain: v });
          }}
          placeholder="example.myshopify.com"
          className="w-[220px] rounded-md border border-muted/20 bg-background px-2 py-1 text-body text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        <a
          className={
            'rounded-md border px-2 py-1 text-caption shadow-sm ' +
            (valid
              ? 'border-muted/20 bg-background text-foreground hover:bg-muted/10'
              : 'cursor-not-allowed border-muted/10 bg-muted/10 text-muted')
          }
          href={valid ? buildAuthUrl(normalized) : undefined}
          aria-disabled={!valid}
          onClick={(e) => {
            if (!valid) e.preventDefault();
            else void update({ lastShopDomain: normalized, activeShopDomain: normalized });
          }}
        >
          Connect
        </a>
      </div>
    </div>
  );
}
