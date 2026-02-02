import { useMemo } from 'react';

import { useApiClient } from '../hooks/use-api';
import { useLocalPreferences } from '../hooks/useLocalPreferences';

export default function SettingsGeneral() {
  const api = useApiClient();
  const {
    shopInfo,
    preferences,
    updatePreferences,
    loading: generalLoading,
    saving: generalSaving,
    error: generalError,
    saveError: generalSaveError,
    lastSavedAt,
  } = useLocalPreferences(api);

  const timezones = useMemo(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
    return ['Europe/Bucharest', 'Europe/London', 'Europe/Paris', 'America/New_York', 'UTC'];
  }, []);

  const generalStatus = useMemo(() => {
    if (generalSaving) return { tone: 'info', label: 'Se salvează preferințele...' };
    if (generalSaveError) return { tone: 'error', label: generalSaveError };
    if (lastSavedAt) return { tone: 'success', label: 'Preferințele au fost salvate.' };
    return null;
  }, [generalSaveError, generalSaving, lastSavedAt]);

  return (
    <div className="space-y-4">
      {generalLoading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
          Se încarcă preferințele...
        </div>
      ) : null}

      {generalError ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
          {generalError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-caption text-muted" htmlFor="shop-name">
            Shop name
          </label>
          <input
            id="shop-name"
            type="text"
            value={shopInfo?.shopName ?? ''}
            placeholder="—"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
          />
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="shop-domain">
            Shop domain
          </label>
          <input
            id="shop-domain"
            type="text"
            value={shopInfo?.shopDomain ?? ''}
            placeholder="store.myshopify.com"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
          />
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="shop-email">
            Shop email
          </label>
          <input
            id="shop-email"
            type="email"
            value={shopInfo?.shopEmail ?? ''}
            placeholder="—"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-caption text-muted" htmlFor="timezone">
          Timezone
        </label>
        <select
          id="timezone"
          value={preferences.timezone}
          onChange={(event) => updatePreferences({ timezone: event.target.value })}
          className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-caption text-muted">Language</div>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex items-center gap-2 text-body">
            <input
              type="radio"
              name="language"
              value="ro"
              checked={preferences.language === 'ro'}
              onChange={() => updatePreferences({ language: 'ro' })}
            />
            Română
          </label>
          <label className="flex items-center gap-2 text-body">
            <input
              type="radio"
              name="language"
              value="en"
              checked={preferences.language === 'en'}
              onChange={() => updatePreferences({ language: 'en' })}
            />
            English
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-body">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={preferences.notificationsEnabled ?? false}
          onChange={(event) => updatePreferences({ notificationsEnabled: event.target.checked })}
        />
        Primește notificări despre sincronizări și alerte
      </label>

      {generalStatus ? (
        <div
          className={`rounded-md border p-3 text-sm shadow-sm ${
            generalStatus.tone === 'error'
              ? 'border-error/30 bg-error/10 text-error'
              : generalStatus.tone === 'success'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-muted/20 bg-muted/5 text-muted'
          }`}
        >
          {generalStatus.label}
        </div>
      ) : null}
    </div>
  );
}
