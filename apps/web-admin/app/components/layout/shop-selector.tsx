import { useEffect, useMemo, useState } from 'react';

import { useUiProfile } from '../../hooks/use-ui-profile';
import { isValidShopDomain, useShopifyAppBridge } from '../../shopify';

async function fetchSessionShopDomain(): Promise<string | null> {
  try {
    const res = await fetch('/api/whoami', { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== 'object') return null;
    const record = json as { data?: { shopDomain?: unknown } };
    return typeof record.data?.shopDomain === 'string' ? record.data.shopDomain : null;
  } catch {
    return null;
  }
}

function buildAuthUrl(shopDomain: string, returnTo: string | null): string {
  const url = new URL('/auth', window.location.origin);
  url.searchParams.set('shop', shopDomain);
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

function normalizeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) return null;
  if (!trimmed.startsWith('/app/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (trimmed.includes('://')) return null;
  return trimmed;
}

export function ShopSelector({ compact = false }: { compact?: boolean }) {
  const { isEmbedded, shop } = useShopifyAppBridge();
  const { profile, loading, update } = useUiProfile();

  const defaultShop = useMemo(() => {
    return shop ?? profile.activeShopDomain ?? profile.lastShopDomain ?? '';
  }, [profile.activeShopDomain, profile.lastShopDomain, shop]);

  const [draft, setDraft] = useState('');
  const [sessionShopDomain, setSessionShopDomain] = useState<string | null>(null);

  useEffect(() => {
    setDraft(defaultShop);
  }, [defaultShop]);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionShopDomain().then((domain) => {
      if (cancelled) return;
      setSessionShopDomain(domain);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isEmbedded) {
    return (
      <div className="min-w-0 text-caption text-muted">
        <div className={compact ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
          {!compact && <span className="text-foreground/80">Shop</span>}
          <span className="truncate text-foreground">{shop ?? '—'}</span>
        </div>
      </div>
    );
  }

  const normalized = draft.trim();
  const valid = normalized.length > 0 && isValidShopDomain(normalized);

  const connected =
    valid &&
    typeof sessionShopDomain === 'string' &&
    sessionShopDomain.trim().toLowerCase() === normalized.toLowerCase();

  const returnTo = useMemo(() => {
    return normalizeReturnTo(`${window.location.pathname}${window.location.search}`);
  }, []);

  const suggestions = useMemo(() => {
    return (profile.recentShopDomains ?? []).filter((d) => isValidShopDomain(d));
  }, [profile.recentShopDomains]);

  const inputId = 'shop-selector';
  const listId = suggestions.length > 0 ? 'shop-selector-recent' : undefined;

  if (compact) {
    return (
      <div className="min-w-0">
        <label
          className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400"
          htmlFor={inputId}
        >
          Magazin Shopify
        </label>
        <div className="flex flex-col gap-2">
          <input
            id={inputId}
            value={draft}
            disabled={loading}
            onChange={(e) => setDraft(e.target.value)}
            list={listId}
            onBlur={() => {
              const v = draft.trim();
              if (!v || !isValidShopDomain(v)) return;
              void update({ lastShopDomain: v, activeShopDomain: v });
            }}
            placeholder="example.myshopify.com"
            className="w-full rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-[var(--shadow-sm)] transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          {suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((domain) => (
                <option key={domain} value={domain} />
              ))}
            </datalist>
          ) : null}
          <a
            className={
              'inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-medium shadow-[var(--shadow-sm)] transition-all duration-200 ' +
              (connected
                ? 'cursor-default border border-emerald-200/80 bg-emerald-50 text-emerald-700'
                : valid
                  ? 'border border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  : 'cursor-not-allowed border border-slate-100 bg-slate-50 text-slate-400')
            }
            href={!connected && valid ? buildAuthUrl(normalized, returnTo) : undefined}
            aria-disabled={!valid || connected}
            onClick={(e) => {
              if (!valid || connected) e.preventDefault();
              else void update({ lastShopDomain: normalized, activeShopDomain: normalized });
            }}
          >
            {connected ? 'Conectat' : 'Conectare'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 text-caption text-muted">
      <label className="sr-only" htmlFor={inputId}>
        Shop
      </label>
      <div className="flex items-center gap-2">
        <span className="text-foreground/80">Shop</span>
        <input
          id={inputId}
          value={draft}
          disabled={loading}
          onChange={(e) => setDraft(e.target.value)}
          list={listId}
          onBlur={() => {
            const v = draft.trim();
            if (!v || !isValidShopDomain(v)) return;
            void update({ lastShopDomain: v, activeShopDomain: v });
          }}
          placeholder="example.myshopify.com"
          className="w-55 rounded-md border border-muted/20 bg-background px-2 py-1 text-body text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        {suggestions.length > 0 ? (
          <datalist id={listId}>
            {suggestions.map((domain) => (
              <option key={domain} value={domain} />
            ))}
          </datalist>
        ) : null}

        <a
          className={
            'rounded-md border px-2 py-1 text-caption shadow-sm ' +
            (connected
              ? 'cursor-default border-success/30 bg-success/10 text-success'
              : valid
                ? 'border-muted/20 bg-background text-foreground hover:bg-muted/10'
                : 'cursor-not-allowed border-muted/10 bg-muted/10 text-muted')
          }
          href={!connected && valid ? buildAuthUrl(normalized, returnTo) : undefined}
          aria-disabled={!valid || connected}
          onClick={(e) => {
            if (!valid || connected) e.preventDefault();
            else void update({ lastShopDomain: normalized, activeShopDomain: normalized });
          }}
        >
          {connected ? 'Connected' : 'Connect'}
        </a>
      </div>
    </div>
  );
}
