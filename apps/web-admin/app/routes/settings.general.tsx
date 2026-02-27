import { useMemo } from 'react';

import { InfoTooltip } from '../components/ui/info-tooltip';
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
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Se încarcă preferințele...
        </div>
      ) : null}

      {generalError ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
          {generalError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            className="inline-flex items-center gap-1 text-caption text-muted dark:text-slate-400"
            htmlFor="shop-name"
          >
            Nume magazin
            <InfoTooltip title="Nume magazin" side="bottom" portalToBody>
              Numele oficial al magazinului Shopify, preluat automat din platforma Shopify. Acest
              nume apare în rapoarte, notificări și e-mailuri. De exemplu, „Neanelu Fashion Store".
              Sfat: modifică-l direct din panoul Shopify dacă vrei să-l schimbi.
            </InfoTooltip>
          </label>
          <input
            id="shop-name"
            type="text"
            value={shopInfo?.shopName ?? ''}
            placeholder="—"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>

        <div>
          <label
            className="inline-flex items-center gap-1 text-caption text-muted dark:text-slate-400"
            htmlFor="shop-domain"
          >
            Domeniu magazin
            <InfoTooltip title="Domeniu magazin" side="bottom" portalToBody>
              Adresa unică a magazinului pe Shopify, folosită pentru autentificare și comunicarea cu
              API-ul. Formatul standard este „nume.myshopify.com". De exemplu,
              „neanelu.myshopify.com" identifică unic shop-ul tău. Sfat: nu se poate schimba manual
              — este setat de Shopify.
            </InfoTooltip>
          </label>
          <input
            id="shop-domain"
            type="text"
            value={shopInfo?.shopDomain ?? ''}
            placeholder="store.myshopify.com"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>

        <div>
          <label className="text-caption text-muted dark:text-slate-400" htmlFor="shop-email">
            Email magazin
          </label>
          <input
            id="shop-email"
            type="email"
            value={shopInfo?.shopEmail ?? ''}
            placeholder="—"
            disabled
            className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      <div>
        <label
          className="flex items-center gap-1.5 text-caption text-muted dark:text-slate-400"
          htmlFor="timezone"
        >
          <span>Fus orar</span>
          <InfoTooltip title="Fus orar" side="bottom" portalToBody>
            Fusul orar determină ora afișată în rapoarte, grafice și programarea sincronizărilor
            automate. Se salvează local în preferințele tale și nu afectează alți utilizatori. De
            exemplu, „Europe/Bucharest" afișează ora României (UTC+2/+3). Sfat: alege fusul
            corespunzător locației echipei tale.
          </InfoTooltip>
        </label>
        <select
          id="timezone"
          value={preferences.timezone}
          onChange={(event) => updatePreferences({ timezone: event.target.value })}
          className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-caption text-muted dark:text-slate-400">
          <span>Limbă</span>
          <InfoTooltip title="Limbă interfață" side="bottom" portalToBody>
            Limba în care se afișează interfața aplicației, inclusiv meniuri, butoane și mesaje.
            Preferința se salvează local în browser. De exemplu, selectând „Română", toate textele
            UI apar în română. Sfat: schimbarea nu afectează datele produselor din Shopify.
          </InfoTooltip>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex items-center gap-2 text-body dark:text-slate-200">
            <input
              type="radio"
              name="language"
              value="ro"
              checked={preferences.language === 'ro'}
              onChange={() => updatePreferences({ language: 'ro' })}
            />
            Română
          </label>
          <label className="flex items-center gap-2 text-body dark:text-slate-200">
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

      <label className="flex items-center gap-2 text-body dark:text-slate-200">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={preferences.notificationsEnabled ?? false}
          onChange={(event) => updatePreferences({ notificationsEnabled: event.target.checked })}
        />
        <span className="inline-flex items-center gap-1">
          Primește notificări despre sincronizări și alerte
          <InfoTooltip title="Notificări" side="bottom" portalToBody>
            Activează notificările în browser pentru evenimente importante: finalizare sincronizare,
            erori de procesare, alerte buget sau praguri de calitate atinse. De exemplu, primești un
            popup când o sincronizare eșuează. Sfat: necesită permisiune de notificări în browser.
          </InfoTooltip>
        </span>
      </label>

      {generalStatus ? (
        <div
          className={`rounded-md border p-3 text-sm shadow-sm ${
            generalStatus.tone === 'error'
              ? 'border-error/30 bg-error/10 text-error dark:border-red-700/50 dark:bg-red-900/20'
              : generalStatus.tone === 'success'
                ? 'border-success/30 bg-success/10 text-success dark:border-emerald-700/50 dark:bg-emerald-900/20'
                : 'border-muted/20 bg-muted/5 text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {generalStatus.label}
        </div>
      ) : null}
    </div>
  );
}
