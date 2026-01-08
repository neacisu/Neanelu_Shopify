import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import {
  clearSessionTokenCache,
  getCachedSessionTokenExpiresAtMs,
  getSessionToken,
} from '../lib/session-auth';

export interface UseSessionTokenOptions {
  shopDomain: string | null;
  isEmbedded: boolean;
  isVitest?: boolean;
  canUseAppBridge?: boolean;
  buildAuthUrl: (shopDomain: string) => string;
}

/**
 * Session token UX:
 * - proactive refresh before expiry
 * - warning toast when close to expiring
 * - fallback state when refresh fails
 */
export function useSessionToken(options: UseSessionTokenOptions) {
  const {
    shopDomain,
    isEmbedded,
    isVitest = false,
    canUseAppBridge = false,
    buildAuthUrl,
  } = options;

  const warnedRef = useRef(false);
  const refreshingRef = useRef(false);
  const [expiredOpen, setExpiredOpen] = useState(false);

  const onReauth = useCallback(() => {
    if (!shopDomain) return;
    window.location.assign(buildAuthUrl(shopDomain));
  }, [buildAuthUrl, shopDomain]);

  const onRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    (async () => {
      clearSessionTokenCache();
      const token = await getSessionToken();
      refreshingRef.current = false;
      if (token) {
        setExpiredOpen(false);
        toast.success('Sesiune reîmprospătată');
      } else {
        setExpiredOpen(true);
      }
    })().catch(() => {
      refreshingRef.current = false;
      setExpiredOpen(true);
    });
  }, []);

  // Warm up token early (helps embedded UX).
  useEffect(() => {
    if (isVitest) return;
    if (!isEmbedded) return;
    // Only warm up when we can actually use App Bridge; otherwise we'd hit the cookie fallback.
    if (!canUseAppBridge) return;
    void getSessionToken();
  }, [canUseAppBridge, isEmbedded, isVitest, shopDomain]);

  useEffect(() => {
    if (isVitest) return;
    if (typeof window === 'undefined') return;

    const interval = window.setInterval(() => {
      const expiresAtMs = getCachedSessionTokenExpiresAtMs();
      if (!expiresAtMs) return;

      const msLeft = expiresAtMs - Date.now();

      // Reset warning after successful refresh (expiry moves forward).
      if (msLeft > 5 * 60_000) {
        warnedRef.current = false;
        if (expiredOpen) setExpiredOpen(false);
      }

      // Warning threshold (plan: 5 minutes).
      // Avoid warning for short-lived Shopify JWT session tokens (usually ~1 minute).
      if (!warnedRef.current && msLeft > 60_000 && msLeft <= 5 * 60_000) {
        warnedRef.current = true;

        toast('Sesiunea expiră în curând', {
          description: 'Vom încerca refresh automat. Dacă e nevoie, reautentifică aplicația.',
          action: shopDomain
            ? {
                label: 'Re-auth',
                onClick: () => {
                  window.location.assign(buildAuthUrl(shopDomain));
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
            setExpiredOpen(true);
          }
        })().catch(() => {
          refreshingRef.current = false;
          setExpiredOpen(true);
        });
      }
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [buildAuthUrl, expiredOpen, isVitest, shopDomain]);

  return {
    expiredOpen,
    setExpiredOpen,
    onRefresh,
    onReauth,
  };
}
