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

const LS_KEY = 'neanelu_last_shop';

function readLastShopFromStorage(): string {
  try {
    return window.localStorage.getItem(LS_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeLastShopToStorage(domain: string): void {
  try {
    if (domain) window.localStorage.setItem(LS_KEY, domain);
  } catch {
    /* ignore */
  }
}

export function ShopSelector({ compact = false }: { compact?: boolean }) {
  const { isEmbedded, shop } = useShopifyAppBridge();
  const { profile, loading, update } = useUiProfile();

  const defaultShop = useMemo(() => {
    return shop ?? profile.activeShopDomain ?? profile.lastShopDomain ?? readLastShopFromStorage();
  }, [profile.activeShopDomain, profile.lastShopDomain, shop]);

  const [draft, setDraft] = useState(defaultShop);
  const [sessionShopDomain, setSessionShopDomain] = useState<string | null>(null);

  useEffect(() => {
    if (defaultShop) setDraft(defaultShop);
  }, [defaultShop]);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionShopDomain().then((domain) => {
      if (cancelled) return;
      setSessionShopDomain(domain);
      if (domain) {
        writeLastShopToStorage(domain);
        setDraft((prev) => (prev ? prev : domain));
      }
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
      <div className="min-w-0" role="group" aria-label="Selector magazin Shopify">
        <label
          className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted"
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
              writeLastShopToStorage(v);
              void update({ lastShopDomain: v, activeShopDomain: v });
            }}
            placeholder="example.myshopify.com"
            title="Introdu domeniul magazinului tău Shopify (ex: magazin.myshopify.com)"
            className="focus-ring w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground shadow-[var(--shadow-sm)] transition-all duration-200 placeholder:text-muted focus:border-primary/50 focus-ring-standard"
          />
          {suggestions.length > 0 ? (
            <datalist id={listId} aria-hidden="true">
              {suggestions.map((domain) => (
                <option key={domain} value={domain} />
              ))}
            </datalist>
          ) : null}
          <a
            className={
              'focus-ring inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-medium shadow-[var(--shadow-sm)] transition-all duration-200 ' +
              (connected
                ? 'cursor-default border border-success/30 bg-success/10 text-success'
                : valid
                  ? 'border border-border bg-background text-foreground hover:scale-[1.02] hover:bg-muted/10 hover:border-muted active:scale-[0.98]'
                  : 'cursor-not-allowed border border-border bg-muted/10 text-muted')
            }
            href={!connected && valid ? buildAuthUrl(normalized, returnTo) : undefined}
            aria-disabled={!valid || connected}
            tabIndex={!valid || connected ? -1 : undefined}
            title={
              connected
                ? 'Magazinul este deja conectat'
                : valid
                  ? 'Conectează-te la magazinul Shopify'
                  : 'Introdu un domeniu valid (ex: magazin.myshopify.com)'
            }
            onClick={(e) => {
              if (!valid || connected) e.preventDefault();
              else {
                writeLastShopToStorage(normalized);
                void update({ lastShopDomain: normalized, activeShopDomain: normalized });
              }
            }}
          >
            {connected ? 'Conectat' : 'Conectare'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-w-0 text-caption text-muted"
      role="group"
      aria-label="Selector magazin Shopify"
    >
      <label className="sr-only" htmlFor={inputId}>
        Magazin
      </label>
      <div className="flex items-center gap-2">
        <span className="text-foreground/80">Magazin</span>
        <input
          id={inputId}
          value={draft}
          disabled={loading}
          onChange={(e) => setDraft(e.target.value)}
          list={listId}
          onBlur={() => {
            const v = draft.trim();
            if (!v || !isValidShopDomain(v)) return;
            writeLastShopToStorage(v);
            void update({ lastShopDomain: v, activeShopDomain: v });
          }}
          placeholder="example.myshopify.com"
          title="Introdu domeniul magazinului tău Shopify (ex: magazin.myshopify.com)"
          className="focus-ring w-55 rounded-md border border-border bg-background px-2 py-1 text-body text-foreground shadow-[var(--shadow-sm)] transition-all duration-200 placeholder:text-muted focus:border-primary/50 focus-ring-standard"
        />

        {suggestions.length > 0 ? (
          <datalist id={listId} aria-hidden="true">
            {suggestions.map((domain) => (
              <option key={domain} value={domain} />
            ))}
          </datalist>
        ) : null}

        <a
          className={
            'focus-ring rounded-md border px-2 py-1 text-caption shadow-[var(--shadow-sm)] transition-all duration-200 ' +
            (connected
              ? 'cursor-default border-success/30 bg-success/10 text-success'
              : valid
                ? 'border-border bg-background text-foreground hover:scale-[1.02] hover:bg-muted/10 hover:border-muted active:scale-[0.98]'
                : 'cursor-not-allowed border-muted/10 bg-muted/10 text-muted')
          }
          href={!connected && valid ? buildAuthUrl(normalized, returnTo) : undefined}
          aria-disabled={!valid || connected}
          title={
            connected
              ? 'Magazinul este deja conectat'
              : valid
                ? 'Conectează-te la magazinul Shopify'
                : 'Introdu un domeniu valid (ex: magazin.myshopify.com)'
          }
          onClick={(e) => {
            if (!valid || connected) e.preventDefault();
            else {
              writeLastShopToStorage(normalized);
              void update({ lastShopDomain: normalized, activeShopDomain: normalized });
            }
          }}
        >
          {connected ? 'Conectat' : 'Conectare'}
        </a>
      </div>
    </div>
  );
}
