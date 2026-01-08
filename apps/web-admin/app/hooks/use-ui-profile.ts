import { useCallback, useEffect, useMemo, useState } from 'react';

import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';

export interface UiProfile {
  activeShopDomain: string | null;
  lastShopDomain: string | null;
}

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

export function useUiProfile() {
  const [profile, setProfile] = useState<UiProfile>({
    activeShopDomain: null,
    lastShopDomain: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getApi<UiProfile>('/ui-profile');
      setProfile({
        activeShopDomain: data.activeShopDomain ?? null,
        lastShopDomain: data.lastShopDomain ?? null,
      });
    } catch (err) {
      // Profile persistence is a UX enhancement; failures should not crash the app.
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async (next: Partial<UiProfile>) => {
    setError(null);
    const payload: Record<string, unknown> = {};
    if ('activeShopDomain' in next) payload.activeShopDomain = next.activeShopDomain;
    if ('lastShopDomain' in next) payload.lastShopDomain = next.lastShopDomain;

    try {
      const data = await api.postApi<UiProfile, Record<string, unknown>>('/ui-profile', payload);
      setProfile({
        activeShopDomain: data.activeShopDomain ?? null,
        lastShopDomain: data.lastShopDomain ?? null,
      });
    } catch (err) {
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
