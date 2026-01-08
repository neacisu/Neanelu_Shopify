import type { To } from 'react-router-dom';

export interface ShopifyEmbeddedParams {
  host: string | null;
  shop: string | null;
  embedded: string | null;
}

export function readShopifyParams(search: string): ShopifyEmbeddedParams {
  const params = new URLSearchParams(search);

  const host = params.get('host');
  const shop = params.get('shop');
  const embedded = params.get('embedded');

  return {
    host: host && host.length > 0 ? host : null,
    shop: shop && shop.length > 0 ? shop : null,
    embedded: embedded && embedded.length > 0 ? embedded : null,
  };
}

export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isProbablyEmbedded(params: ShopifyEmbeddedParams): boolean {
  if (params.embedded === '1' || params.embedded === 'true') return true;
  return isInIframe();
}

export function isValidShopDomain(shop: string): boolean {
  // Keep this permissive enough for custom domains, but reject obvious garbage.
  if (!shop) return false;
  if (shop.length > 255) return false;
  if (/\s/.test(shop)) return false;
  if (!shop.includes('.')) return false;
  return true;
}

export function encodeShopifyHost(shop: string): string {
  // Shopify expects base64-encoded "{shop}/admin" (without protocol).
  // Use URL-safe base64 (same as Shopify)
  const value = `${shop}/admin`;
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('btoa is not available in this environment');
  }
  const b64 = globalThis.btoa(value);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildShopifyAdminAppUrl(shop: string, apiKey: string): string {
  return `https://${shop}/admin/apps/${apiKey}`;
}

function mergeShopifyParams(currentSearch: string, targetSearch: string): string {
  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams(targetSearch);

  for (const key of ['host', 'shop', 'embedded'] as const) {
    if (!next.get(key)) {
      const value = current.get(key);
      if (value) next.set(key, value);
    }
  }

  const serialized = next.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export function withShopifyQuery(to: To, currentSearch: string): To {
  if (typeof to === 'string') {
    const url = new URL(to, 'http://local');
    const mergedSearch = mergeShopifyParams(currentSearch, url.search);
    return `${url.pathname}${mergedSearch}${url.hash}`;
  }

  return {
    ...to,
    search: mergeShopifyParams(currentSearch, to.search ?? ''),
  };
}
