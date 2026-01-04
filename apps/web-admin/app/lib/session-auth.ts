import type { ApiSuccessResponse } from '@app/types';

let cachedToken: string | null = null;
let cachedTokenExpiresAtMs = 0;
let inflight: Promise<string | null> | null = null;

export function clearSessionTokenCache(): void {
  cachedToken = null;
  cachedTokenExpiresAtMs = 0;
  inflight = null;
}

function getJwtExpiresAtMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (!payload) return null;

  try {
    if (typeof globalThis.atob !== 'function') return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = JSON.parse(globalThis.atob(padded)) as {
      exp?: number;
    };
    if (typeof json.exp !== 'number') return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

function getShopifyHostFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const host = new URLSearchParams(window.location.search).get('host');
  return typeof host === 'string' && host.length > 0 ? host : null;
}

async function fetchShopifyAppBridgeSessionToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const host = getShopifyHostFromUrl();
  const apiKey = import.meta.env['VITE_SHOPIFY_API_KEY'] as string | undefined;

  // If not embedded (no host) or missing API key, skip App Bridge.
  if (!host || !apiKey) return null;

  try {
    const [{ default: createApp }, { getSessionToken }] = await Promise.all([
      import('@shopify/app-bridge'),
      import('@shopify/app-bridge-utils'),
    ]);

    const app = createApp({ apiKey, host, forceRedirect: true });
    const token = await getSessionToken(app);
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function fetchSessionToken(): Promise<string | null> {
  const shopifyToken = await fetchShopifyAppBridgeSessionToken();
  if (shopifyToken) return shopifyToken;

  try {
    const response = await fetch('/api/session/token', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return null;

    const body = (await response.json().catch(() => null)) as ApiSuccessResponse<{
      token: string;
    }> | null;

    const token = body?.success === true ? body.data.token : null;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (cachedToken) {
    // For Shopify session tokens (JWT), honor expiry.
    if (cachedTokenExpiresAtMs > 0 && Date.now() > cachedTokenExpiresAtMs - 5_000) {
      cachedToken = null;
      cachedTokenExpiresAtMs = 0;
    } else {
      return cachedToken;
    }
  }

  inflight ??= (async () => {
    const token = await fetchSessionToken();
    cachedToken = token;
    cachedTokenExpiresAtMs = token ? (getJwtExpiresAtMs(token) ?? 0) : 0;
    inflight = null;
    return token;
  })();

  return inflight;
}

export async function getSessionAuthHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
