import { useCallback } from 'react';

import { useSessionToken } from '../hooks/useSessionToken';

import { isValidShopDomain } from './shopify-url';
import { useShopifyAppBridge } from './useShopifyAppBridge';

import { SessionExpiredModal } from '../components/SessionExpiredModal';

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

  const buildAuthUrlForHook = useCallback((shopDomain: string) => buildAuthUrl(shopDomain), []);

  const validShop = shop && isValidShopDomain(shop) ? shop : null;

  const { expiredOpen, setExpiredOpen, onRefresh, onReauth } = useSessionToken({
    shopDomain: validShop,
    isEmbedded,
    isVitest,
    canUseAppBridge,
    buildAuthUrl: buildAuthUrlForHook,
  });

  return (
    <SessionExpiredModal
      open={expiredOpen}
      shopDomain={validShop}
      onRefresh={onRefresh}
      onReauth={onReauth}
      onClose={() => setExpiredOpen(false)}
    />
  );
}
