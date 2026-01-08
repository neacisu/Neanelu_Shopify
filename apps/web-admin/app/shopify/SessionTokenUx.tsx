import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import {
  clearSessionTokenCache,
  getCachedSessionTokenExpiresAtMs,
  getSessionToken,
} from '../lib/session-auth';

import { isValidShopDomain } from './shopify-url';
import { useShopifyAppBridge } from './useShopifyAppBridge';

function buildAuthUrl(shopDomain: string): string {
  const url = new URL('/auth', window.location.origin);
  url.searchParams.set('shop', shopDomain);
  return url.toString();
}

/**
 * Session token UX:
 * - proactive refresh before expiry
 * - warning toast when close to expiring
 * - avoids stale tokens when switching shops/hosts (handled by session-auth cache key)
 */
export function SessionTokenUx() {
  const { shop, isEmbedded } = useShopifyAppBridge();

  const isVitest = Boolean((import.meta.env as Record<string, unknown>)['VITEST']);

  const canUseAppBridge = (() => {
    if (typeof window === 'undefined') return false;
    const apiKey = import.meta.env['VITE_SHOPIFY_API_KEY'] as string | undefined;
    if (!apiKey) return false;
    const host = new URLSearchParams(window.location.search).get('host');
    return typeof host === 'string' && host.length > 0;
  })();

  const warnedRef = useRef(false);
  const refreshingRef = useRef(false);

  // Warm up token early (helps embedded UX).
  useEffect(() => {
    if (isVitest) return;
    if (!isEmbedded) return;
    // Only warm up when we can actually use App Bridge; otherwise we'd hit the cookie fallback
    // (which is unnecessary background traffic and adds test flakiness).
    if (!canUseAppBridge) return;
    void getSessionToken();
  }, [canUseAppBridge, isEmbedded, isVitest, shop]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const expiresAtMs = getCachedSessionTokenExpiresAtMs();
      if (!expiresAtMs) return;

      const msLeft = expiresAtMs - Date.now();

      // Reset warning after successful refresh (expiry moves forward).
      if (msLeft > 5 * 60_000) {
        warnedRef.current = false;
      }

      // Warning threshold.
      if (!warnedRef.current && msLeft > 0 && msLeft <= 2 * 60_000) {
        warnedRef.current = true;

        toast('Sesiunea expiră în curând', {
          description: 'Vom încerca refresh automat. Dacă e nevoie, reautentifică aplicația.',
          action:
            shop && isValidShopDomain(shop)
              ? {
                  label: 'Re-auth',
                  onClick: () => {
                    window.location.assign(buildAuthUrl(shop));
                  },
                }
              : undefined,
        });
      }

      // Refresh window.
      if (!refreshingRef.current && msLeft > 0 && msLeft <= 30_000) {
        refreshingRef.current = true;

        (async () => {
          clearSessionTokenCache();
          const token = await getSessionToken();
          refreshingRef.current = false;

          if (!token) {
            toast.error('Sesiunea a expirat', {
              description: 'Reautentifică aplicația pentru a continua.',
              action:
                shop && isValidShopDomain(shop)
                  ? {
                      label: 'Re-auth',
                      onClick: () => {
                        window.location.assign(buildAuthUrl(shop));
                      },
                    }
                  : undefined,
            });
          }
        })().catch(() => {
          refreshingRef.current = false;
        });
      }
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [shop]);

  return null;
}
