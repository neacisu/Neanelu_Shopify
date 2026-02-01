import { useCallback, useEffect, useRef, useState } from 'react';

import type { ShopGeneralSettings } from '@app/types';

import type { useApiClient } from './use-api';

type ApiClient = ReturnType<typeof useApiClient>;

type Preferences = ShopGeneralSettings['preferences'];

const STORAGE_KEYS = {
  timezone: 'neanelu_preferences_timezone',
  language: 'neanelu_preferences_language',
} as const;

function readFromLocalStorage(): Partial<Preferences> {
  if (typeof window === 'undefined') return {};
  return {
    timezone: window.localStorage.getItem(STORAGE_KEYS.timezone) ?? undefined,
    language:
      (window.localStorage.getItem(STORAGE_KEYS.language) as Preferences['language']) ?? undefined,
  };
}

function writeToLocalStorage(preferences: Preferences) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEYS.timezone, preferences.timezone);
  window.localStorage.setItem(STORAGE_KEYS.language, preferences.language);
}

export function useLocalPreferences(api: ApiClient) {
  const [shopInfo, setShopInfo] = useState<Pick<
    ShopGeneralSettings,
    'shopName' | 'shopDomain' | 'shopEmail'
  > | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const local = readFromLocalStorage();
    return {
      timezone: local.timezone ?? 'Europe/Bucharest',
      language: local.language ?? 'ro',
      notificationsEnabled: undefined,
    };
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getApi<ShopGeneralSettings>('/settings/shop');
        if (!active) return;

        setShopInfo({
          shopName: data.shopName,
          shopDomain: data.shopDomain,
          shopEmail: data.shopEmail,
        });
        setPreferences(data.preferences);
        writeToLocalStorage(data.preferences);
      } catch (err) {
        if (active) {
          const message = err instanceof Error ? err.message : 'Nu am putut încărca preferințele.';
          setError(message);
        }
      } finally {
        if (active) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [api]);

  const persist = useCallback(
    (next: Preferences) => {
      setPreferences(next);
      writeToLocalStorage(next);

      if (!hydratedRef.current) return;

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        void (async () => {
          setSaving(true);
          setSaveError(null);
          try {
            await api.getApi('/settings/shop', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(next),
            });
            setLastSavedAt(new Date().toISOString());
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Salvarea preferințelor a eșuat.';
            setSaveError(message);
          } finally {
            setSaving(false);
          }
        })();
      }, 500);
    },
    [api]
  );

  const updatePreferences = useCallback(
    (partial: Partial<Preferences>) => {
      persist({
        ...preferences,
        ...partial,
      });
    },
    [persist, preferences]
  );

  return {
    shopInfo,
    preferences,
    updatePreferences,
    loading,
    saving,
    error,
    saveError,
    lastSavedAt,
  };
}
