import { useCallback, useEffect, useMemo, useState } from 'react';

import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';
import { ApiError } from '../utils/api-error';

export interface UiProfile {
  activeShopDomain: string | null;
  lastShopDomain: string | null;
  recentShopDomains: string[];
}

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

const UI_PROFILE_BACKOFF_KEY = 'neanelu.uiProfileEndpointMissingUntilMs';

function readUiProfileBackoffUntilMs(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(UI_PROFILE_BACKOFF_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeUiProfileBackoffUntilMs(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (value > 0) window.sessionStorage.setItem(UI_PROFILE_BACKOFF_KEY, String(value));
    else window.sessionStorage.removeItem(UI_PROFILE_BACKOFF_KEY);
  } catch {
    // ignore
  }
}

let uiProfileEndpointMissingUntilMs = readUiProfileBackoffUntilMs();

function setUiProfileBackoffMs(durationMs: number): void {
  const until = Date.now() + durationMs;
  uiProfileEndpointMissingUntilMs = until;
  writeUiProfileBackoffUntilMs(until);
}

function clearUiProfileBackoff(): void {
  uiProfileEndpointMissingUntilMs = 0;
  writeUiProfileBackoffUntilMs(0);
}

export function useUiProfile() {
  const [profile, setProfile] = useState<UiProfile>({
    activeShopDomain: null,
    lastShopDomain: null,
    recentShopDomains: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (uiProfileEndpointMissingUntilMs > 0 && Date.now() < uiProfileEndpointMissingUntilMs) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.getApi<UiProfile>('/ui-profile');
      if (uiProfileEndpointMissingUntilMs > 0) clearUiProfileBackoff();
      setProfile({
        activeShopDomain: data.activeShopDomain ?? null,
        lastShopDomain: data.lastShopDomain ?? null,
        recentShopDomains: Array.isArray(
          (data as unknown as { recentShopDomains?: unknown }).recentShopDomains
        )
          ? (data as unknown as { recentShopDomains: string[] }).recentShopDomains
          : [],
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Backend route not deployed on this environment; stop hammering it.
        setUiProfileBackoffMs(5 * 60_000);
      }
      // Profile persistence is a UX enhancement; failures should not crash the app.
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async (next: Partial<UiProfile>) => {
    if (uiProfileEndpointMissingUntilMs > 0 && Date.now() < uiProfileEndpointMissingUntilMs) {
      return;
    }

    setError(null);
    const payload: Record<string, unknown> = {};
    if (typeof next.activeShopDomain !== 'undefined') {
      payload['activeShopDomain'] = next.activeShopDomain;
    }
    if (typeof next.lastShopDomain !== 'undefined') {
      payload['lastShopDomain'] = next.lastShopDomain;
    }

    try {
      const data = await api.postApi<UiProfile, Record<string, unknown>>('/ui-profile', payload);
      if (uiProfileEndpointMissingUntilMs > 0) clearUiProfileBackoff();
      setProfile({
        activeShopDomain: data.activeShopDomain ?? null,
        lastShopDomain: data.lastShopDomain ?? null,
        recentShopDomains: Array.isArray(
          (data as unknown as { recentShopDomains?: unknown }).recentShopDomains
        )
          ? (data as unknown as { recentShopDomains: string[] }).recentShopDomains
          : [],
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setUiProfileBackoffMs(5 * 60_000);
      }
      setError(err);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      // refresh() handles errors; this is only to avoid unhandled promise warnings.
    });
  }, [refresh]);

  return useMemo(
    () => ({
      profile,
      loading,
      error,
      refresh,
      update,
    }),
    [error, loading, profile, refresh, update]
  );
}
