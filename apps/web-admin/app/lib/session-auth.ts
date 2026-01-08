import type { ApiSuccessResponse } from '@app/types';

import { getAppBridgeApp } from '../shopify/app-bridge-singleton';

let cachedToken: string | null = null;
let cachedTokenExpiresAtMs = 0;
let inflight: Promise<string | null> | null = null;
let cookieTokenEndpointMissingUntilMs = 0;
let cachedTokenKey: string | null = null;

export function clearSessionTokenCache(): void {
  cachedToken = null;
  cachedTokenExpiresAtMs = 0;
  inflight = null;
  cookieTokenEndpointMissingUntilMs = 0;
  cachedTokenKey = null;
}

export function getCachedSessionTokenExpiresAtMs(): number {
  return cachedTokenExpiresAtMs;
}

function getSessionTokenCacheKeyFromUrl(): string {
  if (typeof window === 'undefined') return 'server';
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') ?? '';
  const shop = params.get('shop') ?? '';
  const embedded = params.get('embedded') ?? '';
  return `${host}|${shop}|${embedded}`;
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

function isEmbeddedContextForAppBridge(): boolean {
  if (typeof window === 'undefined') return false;

  const embedded = new URLSearchParams(window.location.search).get('embedded');
  if (embedded === '1' || embedded === 'true') return true;

  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin iframe access can throw; treat as embedded.
    return true;
  }
}

async function fetchShopifyAppBridgeSessionToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const apiKey = import.meta.env['VITE_SHOPIFY_API_KEY'] as string | undefined;

  // If missing API key, skip App Bridge.
  if (!apiKey) return null;

  try {
    const [{ default: createApp }, { getSessionToken }] = await Promise.all([
      import('@shopify/app-bridge'),
      import('@shopify/app-bridge/utilities/session-token'),
    ]);

    const existingApp = getAppBridgeApp();
    const app =
      existingApp ??
      (() => {
        if (!isEmbeddedContextForAppBridge()) return null;
        const host = getShopifyHostFromUrl();
        if (!host) return null;
        return createApp({ apiKey, host, forceRedirect: true });
      })();

    if (!app) return null;

    const token = await getSessionToken(app);
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function fetchSessionToken(): Promise<string | null> {
  const shopifyToken = await fetchShopifyAppBridgeSessionToken();
  if (shopifyToken) return shopifyToken;

  // Avoid infinite noisy retries when the backend route is not deployed.
  if (cookieTokenEndpointMissingUntilMs > 0 && Date.now() < cookieTokenEndpointMissingUntilMs) {
    return null;
  }

  try {
    const response = await fetch('/api/session/token', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        cookieTokenEndpointMissingUntilMs = Date.now() + 5 * 60_000;
      }
      return null;
    }

    const body = (await response.json().catch(() => null)) as ApiSuccessResponse<{
      token: string;
      expiresAt?: string;
    }> | null;

    const token = body?.success === true ? body.data.token : null;
    const expiresAt = body?.success === true ? (body.data.expiresAt ?? null) : null;

    // For cookie-minted tokens (non-JWT), rely on explicit metadata.
    if (expiresAt && token && token.split('.').length !== 3) {
      const parsed = Date.parse(expiresAt);
      cachedTokenExpiresAtMs = Number.isFinite(parsed) ? parsed : 0;
    }

    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function getSessionToken(): Promise<string | null> {
  const currentKey = getSessionTokenCacheKeyFromUrl();
  if (cachedTokenKey && cachedTokenKey !== currentKey) {
    clearSessionTokenCache();
  }
  cachedTokenKey = currentKey;

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
    // Prefer JWT expiry (Shopify session tokens); cookie-token expiry may be set by fetchSessionToken.
    const jwtExpiresAt = token ? getJwtExpiresAtMs(token) : null;
    cachedTokenExpiresAtMs = jwtExpiresAt ?? cachedTokenExpiresAtMs ?? 0;
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
