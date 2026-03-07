import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  GeminiHealthResponse,
  GeminiSettingsResponse,
  GeminiSettingsUpdateRequest,
} from '@app/types';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { SubmitButton } from '../components/forms/submit-button';
import { useApiClient } from '../hooks/use-api';

type GeminiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

const STATUS_LABELS: Record<GeminiConnectionStatus, string> = {
  unknown: 'necunoscut',
  connected: 'conectat',
  error: 'eroare',
  disabled: 'dezactivat',
  missing_key: 'cheie lipsă',
  pending: 'în așteptare',
};

const STATUS_STYLES: Record<GeminiConnectionStatus, string> = {
  unknown: 'bg-muted/20 text-muted dark:bg-slate-700/30 dark:text-slate-400',
  connected: 'bg-success/15 text-success dark:bg-emerald-900/30 dark:text-emerald-400',
  error: 'bg-error/15 text-error dark:bg-red-900/30 dark:text-red-400',
  disabled: 'bg-warning/15 text-warning dark:bg-amber-900/30 dark:text-amber-400',
  missing_key: 'bg-warning/15 text-warning dark:bg-amber-900/30 dark:text-amber-400',
  pending: 'bg-blue-500/15 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
};

function normalizeStatus(
  value: GeminiSettingsResponse['connectionStatus']
): GeminiConnectionStatus {
  if (
    value === 'connected' ||
    value === 'error' ||
    value === 'disabled' ||
    value === 'missing_key' ||
    value === 'pending' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export default function SettingsGemini() {
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [rateLimit, setRateLimit] = useState(60);
  const [dailyBudget, setDailyBudget] = useState(1000);
  const [budgetAlertThreshold, setBudgetAlertThreshold] = useState(0.8);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [todayUsage, setTodayUsage] = useState<GeminiSettingsResponse['todayUsage'] | undefined>(
    undefined
  );
  const [connectionStatus, setConnectionStatus] = useState<GeminiConnectionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<GeminiHealthResponse | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getApi<GeminiSettingsResponse>('/settings/gemini');
        if (cancelled) return;
        setEnabled(data.enabled);
        setModel(data.model ?? '');
        setAvailableModels(data.availableModels ?? []);
        setTemperature(data.temperature ?? 0.1);
        setMaxTokens(data.maxTokensPerRequest ?? 2000);
        setRateLimit(data.rateLimitPerMinute ?? 60);
        setDailyBudget(data.dailyBudget ?? 1000);
        setBudgetAlertThreshold(data.budgetAlertThreshold ?? 0.8);
        setHasApiKey(data.hasApiKey);
        setTodayUsage(data.todayUsage);
        const nextStatus = normalizeStatus(data.connectionStatus);
        setConnectionStatus(nextStatus);
        setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
        setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
        setLastError(coerceNullableString(data.lastError));
        if (data.connectionStatus === 'connected' && data.hasApiKey) {
          setLastTestedKey('__stored__');
        } else {
          setLastTestedKey(null);
        }
        setHealthResult(null);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Nu am putut încărca setările Gemini.';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [success]);

  const submitState = useMemo(() => {
    if (saving) return 'loading';
    if (success) return 'success';
    if (error) return 'error';
    return 'idle';
  }, [error, saving, success]);

  const effectiveKey = apiKeyDirty ? apiKey.trim() : hasApiKey ? '__stored__' : '';
  const isConnectionTested = lastTestedKey === effectiveKey;
  const mustTestConnection = enabled || apiKeyDirty;
  const canSave = !mustTestConnection || isConnectionTested;
  const isConnected = connectionStatus === 'connected' && enabled && hasApiKey && !apiKeyDirty;
  const statusLabel = STATUS_LABELS[connectionStatus];
  const statusStyle = STATUS_STYLES[connectionStatus];
  const budgetPercent = Math.min(Math.max(todayUsage?.percentUsed ?? 0, 0), 1);

  const testHealth = async () => {
    setHealthLoading(true);
    setHealthResult(null);
    try {
      const trimmedKey = apiKeyDirty ? apiKey.trim() : '';
      const usingOverride = trimmedKey.length > 0;
      const usingStoredKey = !usingOverride && hasApiKey;
      let data: GeminiHealthResponse;
      if (trimmedKey) {
        data = await api.postApi<GeminiHealthResponse, { apiKey: string }>(
          '/settings/gemini/health',
          {
            apiKey: trimmedKey,
          }
        );
      } else if (hasApiKey) {
        data = await api.postApi<GeminiHealthResponse, { useStoredKey: true }>(
          '/settings/gemini/health',
          { useStoredKey: true }
        );
      } else {
        data = await api.getApi<GeminiHealthResponse>('/settings/gemini/health');
      }
      setHealthResult(data);
      if (data.status === 'ok' && data.availableModels && data.availableModels.length > 0) {
        setAvailableModels(data.availableModels);
      }
      if (usingStoredKey) {
        setLastCheckedAt(new Date().toISOString());
        if (data.status === 'ok') {
          setConnectionStatus('connected');
          setLastError(null);
          setLastSuccessAt(new Date().toISOString());
        } else if (data.status === 'disabled') {
          setConnectionStatus('disabled');
          setLastError(null);
        } else if (data.status === 'missing_key') {
          setConnectionStatus('missing_key');
          setLastError(null);
        } else {
          setConnectionStatus('error');
          setLastError(data.message ?? 'Eroare conexiune');
        }
      }
      if (data.status === 'ok') {
        setLastTestedKey(trimmedKey ? trimmedKey : '__stored__');
      } else {
        setLastTestedKey(null);
      }
    } catch (err) {
      setHealthResult({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : 'Testul conexiunii Gemini a eșuat.',
      });
      setLastTestedKey(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      setError('Testează conexiunea înainte de a salva setările Gemini.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: GeminiSettingsUpdateRequest = {
        enabled,
        model: model || null,
        temperature,
        maxTokensPerRequest: maxTokens,
        rateLimitPerMinute: rateLimit,
        dailyBudget,
        budgetAlertThreshold,
      };
      if (apiKeyDirty) {
        payload.apiKey = apiKey;
      }
      const data = await api.putApi<GeminiSettingsResponse, Record<string, unknown>>(
        '/settings/gemini',
        payload as Record<string, unknown>
      );
      setHasApiKey(data.hasApiKey);
      setConnectionStatus(normalizeStatus(data.connectionStatus));
      setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
      setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
      setLastError(coerceNullableString(data.lastError));
      setApiKey('');
      setApiKeyDirty(false);
      setSuccess(true);
      if (lastTestedKey) {
        setLastTestedKey('__stored__');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Salvarea setărilor Gemini a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const disconnectConnection = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: GeminiSettingsUpdateRequest = {
        enabled: false,
        apiKey: '',
      };
      const data = await api.putApi<GeminiSettingsResponse, Record<string, unknown>>(
        '/settings/gemini',
        payload as Record<string, unknown>
      );
      setEnabled(false);
      setHasApiKey(data.hasApiKey);
      setConnectionStatus(normalizeStatus(data.connectionStatus));
      setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
      setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
      setLastError(coerceNullableString(data.lastError));
      setApiKey('');
      setApiKeyDirty(false);
      setHealthResult(null);
      setLastTestedKey(null);
      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deconectarea Gemini a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Se încarcă setările Gemini...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted dark:text-slate-400">
          <span>Status conexiune</span>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle}`}>
            {statusLabel}
          </span>
          {lastCheckedAt ? (
            <span>verificat {new Date(lastCheckedAt).toLocaleString('ro-RO')}</span>
          ) : null}
          {lastSuccessAt ? (
            <span>succes {new Date(lastSuccessAt).toLocaleString('ro-RO')}</span>
          ) : null}
        </div>
        {lastError ? <div className="mt-1 text-xs text-error">{lastError}</div> : null}
      </div>

      {todayUsage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-sm text-muted dark:text-slate-400">Cereri azi</div>
            <div className="mt-1 text-2xl font-semibold dark:text-slate-100">
              {todayUsage.requests.toLocaleString('ro-RO')}
            </div>
          </div>
          <div className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-sm text-muted dark:text-slate-400">Tokeni intrare</div>
            <div className="mt-1 text-2xl font-semibold dark:text-slate-100">
              {todayUsage.inputTokens.toLocaleString('ro-RO')}
            </div>
          </div>
          <div className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-sm text-muted dark:text-slate-400">Buget utilizat</div>
            <div className="mt-1 text-2xl font-semibold dark:text-slate-100">
              {(todayUsage.percentUsed * 100).toLocaleString('ro-RO', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
              %
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted/10 dark:bg-slate-700/50">
              <div
                className="h-2 rounded-full bg-primary/60"
                style={{ width: `${budgetPercent * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => void saveSettings(event)} className="space-y-4">
        <label className="flex items-center gap-2 text-body dark:text-slate-200">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
          />
          Activează Google Gemini
          <InfoTooltip title="Activează Google Gemini" side="bottom" portalToBody>
            Activează sau dezactivează integrarea Google Gemini. Gemini oferă modele eficiente
            pentru traducere, clasificare și generare de text. Sfat: Gemini 2.5 Flash oferă cel mai
            bun raport calitate/preț.
          </InfoTooltip>
        </label>

        <div>
          <label
            className="text-caption text-muted dark:text-slate-400 inline-flex items-center gap-1"
            htmlFor="gemini-api-key"
          >
            Cheie API Gemini
            <InfoTooltip title="Cheie API Gemini" side="bottom" portalToBody>
              Cheia de acces la Google Gemini API. Obțineți o cheie din Google AI Studio
              (aistudio.google.com). Format: „AIza...". Sfat: cheia e stocată criptat.
            </InfoTooltip>
          </label>
          <input
            id="gemini-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyDirty(true);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
            placeholder={hasApiKey ? '••••••••' : 'AIza...'}
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
          />
          <p className="mt-1 text-xs text-muted dark:text-slate-400">
            Cheia este stocată criptat în baza de date.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Model
              <InfoTooltip title="Model Gemini" side="bottom" portalToBody>
                Modelul Gemini folosit. Flash e rapid și economic; Pro e mai precis pentru sarcini
                complexe. Sfat: lista se actualizează după testul conexiunii.
              </InfoTooltip>
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            >
              {availableModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Tokeni max per cerere
              <InfoTooltip title="Tokeni max per cerere" side="bottom" portalToBody>
                Limita maximă de tokeni pentru răspunsul modelului la o singură cerere. Valori mai
                mari permit răspunsuri mai detaliate dar cresc costul per cerere. De exemplu,
                extragerea specificațiilor unui laptop necesită ~1500 tokeni. Sfat: 2000–4000 e
                suficient pentru majoritatea produselor.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={256}
              max={8000}
              value={maxTokens}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
        </div>

        <div>
          <label
            className="text-caption text-muted dark:text-slate-400 inline-flex items-center gap-1"
            htmlFor="gemini-temperature"
          >
            Temperatură:{' '}
            {temperature.toLocaleString('ro-RO', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <InfoTooltip title="Temperatură Gemini" side="bottom" portalToBody>
              Controlul aleatoriei în răspunsurile modelului. 0 = determinist maxim, ideal pentru
              extracție structurată unde vrei consistență. Valori mai mari (0,5–0,7) produc
              răspunsuri mai variate. De exemplu, la 0,1 aceleași date de intrare produc mereu
              același JSON. Sfat: 0,1 e recomandat pentru reproductibilitate.
            </InfoTooltip>
          </label>
          <input
            id="gemini-temperature"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Limită rată (cereri/min)
              <InfoTooltip title="Limită rată Gemini" side="bottom" portalToBody>
                Câte cereri se pot trimite pe minut către Gemini API. Protejează contra depășirii
                limitelor API și a costurilor neprevăzute. De exemplu, 60 cereri/min procesează ~1
                produs/secundă. Sfat: 60 cereri/min e un echilibru bun; creșteți pentru volume mari
                de procesare.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              value={rateLimit}
              onChange={(event) => setRateLimit(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Buget zilnic
              <InfoTooltip title="Buget zilnic Gemini" side="bottom" portalToBody>
                Numărul maxim de cereri către Gemini pe zi. La atingerea limitei, procesarea AI se
                oprește automat până a doua zi. De exemplu, cu 1000 cereri/zi poți procesa ~1000
                pagini de produs. Sfat: ajustează în funcție de volumul catalogului tău.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={0}
              max={100000}
              value={dailyBudget}
              onChange={(event) => setDailyBudget(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Prag alertă buget
              <InfoTooltip title="Prag alertă buget Gemini" side="bottom" portalToBody>
                Procentul din bugetul zilnic la care primești o avertizare vizuală. Te ajută să
                reacționezi înainte de atingerea limitei absolute. De exemplu, la 0,8 cu buget de
                1000, alerta apare după 800 cereri. Sfat: setează la 80–90% pentru marjă suficientă.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={0.5}
              max={0.99}
              step={0.01}
              value={budgetAlertThreshold}
              onChange={(event) => setBudgetAlertThreshold(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări Gemini'}
          </SubmitButton>
          {isConnected ? (
            <button
              type="button"
              onClick={() => void disconnectConnection()}
              disabled={saving}
              className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm hover:bg-error/5 disabled:opacity-50 dark:border-red-700/50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Deconectează
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void testHealth()}
            disabled={!hasApiKey && !apiKeyDirty}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm transition-shadow duration-200 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:focus:ring-blue-400/50"
          >
            {healthLoading ? 'Se testează...' : 'Test conexiune'}
          </button>
          {healthResult ? (
            <span
              className={`text-xs ${healthResult.status === 'ok' ? 'text-success' : 'text-error'}`}
            >
              {healthResult.status === 'ok'
                ? `Conexiune OK (${(healthResult.latencyMs ?? 0).toLocaleString('ro-RO')} ms)`
                : healthResult.status === 'disabled'
                  ? 'Gemini dezactivat'
                  : healthResult.status === 'missing_key'
                    ? 'API key lipsă'
                    : (healthResult.message ?? 'Eroare conexiune')}
            </span>
          ) : null}
        </div>

        {!canSave && !isConnected ? (
          <div className="text-xs text-warning dark:text-amber-400">
            Pentru a salva conexiunea, testează mai întâi conexiunea Gemini.
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm dark:border-emerald-700/50 dark:bg-emerald-900/20">
            Setările Gemini au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
