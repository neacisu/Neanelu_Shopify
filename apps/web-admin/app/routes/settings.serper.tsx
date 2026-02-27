import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  SerperHealthResponse,
  SerperSettingsResponse,
  SerperSettingsUpdateRequest,
} from '@app/types';

import { InfoTooltip } from '../components/ui/info-tooltip';
import { SubmitButton } from '../components/forms/submit-button';
import { useApiClient } from '../hooks/use-api';

type SerperConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

function normalizeStatus(
  value: SerperSettingsResponse['connectionStatus']
): SerperConnectionStatus {
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

const CONNECTION_STATUS_LABELS: Record<SerperConnectionStatus, string> = {
  unknown: 'necunoscut',
  connected: 'conectat',
  error: 'eroare',
  disabled: 'dezactivat',
  missing_key: 'cheie lipsă',
  pending: 'în așteptare',
};

export default function SettingsSerper() {
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [dailyBudget, setDailyBudget] = useState(1000);
  const [rateLimitPerSecond, setRateLimitPerSecond] = useState(10);
  const [cacheTtlHours, setCacheTtlHours] = useState(24);
  const [budgetAlertThreshold, setBudgetAlertThreshold] = useState(0.8);
  const [todayUsage, setTodayUsage] = useState<SerperSettingsResponse['todayUsage']>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<SerperConnectionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<SerperHealthResponse | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getApi<SerperSettingsResponse>('/settings/serper');
        if (cancelled) return;
        setEnabled(data.enabled);
        setHasApiKey(data.hasApiKey);
        setDailyBudget(data.dailyBudget);
        setRateLimitPerSecond(data.rateLimitPerSecond);
        setCacheTtlHours(Math.round(data.cacheTtlSeconds / 3600));
        setBudgetAlertThreshold(data.budgetAlertThreshold);
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
            err instanceof Error ? err.message : 'Nu am putut încărca setările Serper.';
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

  const testConnection = async () => {
    setHealthLoading(true);
    setHealthResult(null);
    try {
      const trimmedKey = apiKeyDirty ? apiKey.trim() : '';
      const usingOverride = trimmedKey.length > 0;
      const usingStoredKey = !usingOverride && hasApiKey;
      let data: SerperHealthResponse;
      if (trimmedKey) {
        data = await api.postApi<SerperHealthResponse, { apiKey: string }>(
          '/settings/serper/health',
          { apiKey: trimmedKey }
        );
      } else if (hasApiKey) {
        data = await api.postApi<SerperHealthResponse, { useStoredKey: true }>(
          '/settings/serper/health',
          { useStoredKey: true }
        );
      } else {
        data = await api.getApi<SerperHealthResponse>('/settings/serper/health');
      }
      setHealthResult(data);
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
        message: err instanceof Error ? err.message : 'Test conexiune eșuat.',
      });
      setLastTestedKey(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      setError('Testează conexiunea înainte de a salva setările Serper.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: SerperSettingsUpdateRequest = {
        enabled,
        dailyBudget,
        rateLimitPerSecond,
        cacheTtlSeconds: cacheTtlHours * 3600,
        budgetAlertThreshold,
      };
      if (apiKeyDirty && apiKey) {
        payload.apiKey = apiKey;
      }
      const data = await api.putApi<SerperSettingsResponse, SerperSettingsUpdateRequest>(
        '/settings/serper',
        payload
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
      const message = err instanceof Error ? err.message : 'Salvarea setărilor Serper a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const disconnectConnection = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: SerperSettingsUpdateRequest = {
        enabled: false,
        apiKey: '',
      };
      const data = await api.putApi<SerperSettingsResponse, SerperSettingsUpdateRequest>(
        '/settings/serper',
        payload
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
      const message = err instanceof Error ? err.message : 'Deconectarea Serper a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="font-medium text-body dark:text-slate-100">
          Serper API - Cautare externa produse
        </h3>
        <p className="mt-1 text-sm text-muted dark:text-slate-400">
          Configurează integrarea cu Serper API pentru căutarea externă de produse (Golden Record
          Stage 4). Obține un API key gratuit de la{' '}
          <a
            href="https://serper.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline dark:text-blue-400"
          >
            serper.dev
          </a>{' '}
          (2500 queries gratuite).
        </p>
      </div>

      {loading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Se încarcă setările Serper...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
          {error}
        </div>
      ) : null}

      {todayUsage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-sm text-muted dark:text-slate-400">Cereri azi</div>
            <div className="mt-1 text-2xl font-semibold dark:text-slate-100">
              {todayUsage.requests.toLocaleString('ro-RO')}
            </div>
          </div>
          <div className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80">
            <div className="text-sm text-muted dark:text-slate-400">Cost estimat</div>
            <div className="mt-1 text-2xl font-semibold dark:text-slate-100">
              {todayUsage.cost.toLocaleString('ro-RO', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}{' '}
              USD
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
            {todayUsage.percentUsed >= budgetAlertThreshold ? (
              <div className="mt-1 text-xs text-warning dark:text-amber-400">
                Aproape de limita zilnică!
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <form onSubmit={(e) => void saveSettings(e)} className="space-y-4">
        <label className="flex items-center gap-2 text-body dark:text-slate-200">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
          />
          <span className="inline-flex items-center gap-1">
            Activează Serper API pentru acest shop
            <InfoTooltip title="Activare Serper" side="bottom" portalToBody>
              Activează sau dezactivează integrarea cu Serper pentru căutarea externă de produse.
              Serper caută pe Google informații suplimentare folosite în Golden Record Stage 4. De
              exemplu, dezactivarea oprește îmbogățirea datelor din surse externe. Sfat: verifică
              bugetul disponibil înainte de activare.
            </InfoTooltip>
          </span>
        </label>

        <div>
          <label
            className="text-caption text-muted dark:text-slate-400 inline-flex items-center gap-1"
            htmlFor="serper-api-key"
          >
            Cheie API Serper
            <InfoTooltip title="Cheie API Serper" side="bottom" portalToBody>
              Cheia de acces la Serper API pentru căutarea externă de produse (Golden Record).
              Obțineți o cheie gratuită de la serper.dev (2500 cereri/lună gratuite). De exemplu,
              format: un șir alfanumeric de ~40 caractere. Sfat: cheia e stocată criptat; lăsați gol
              dacă e deja salvată.
            </InfoTooltip>
          </label>
          <input
            id="serper-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setApiKeyDirty(true);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
            placeholder={hasApiKey ? '••••••••' : 'Introdu cheia de la serper.dev'}
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
          />
          <p className="mt-1 text-xs text-muted dark:text-slate-400">
            Cheia este stocată criptat în baza de date.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Buget zilnic (cereri)
              <InfoTooltip title="Buget zilnic Serper" side="bottom" portalToBody>
                Numărul maxim de cereri către Serper pe zi. Limita protejează contra depășirii
                costurilor, mai ales pe planuri plătite. De exemplu, cu 100 cereri/zi poți căuta
                informații pentru ~100 produse. Sfat: Serper oferă 2500 cereri gratuite lunar —
                ajustați bugetul zilnic corespunzător.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={100000}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Limită rată (cereri/sec)
              <InfoTooltip title="Limită rată Serper" side="bottom" portalToBody>
                Câte cereri se pot trimite pe secundă către Serper API. Valori mai mici reduc riscul
                de blocare de către Google. De exemplu, 10 cereri/sec procesează 600 produse pe
                minut. Sfat: planul gratuit suportă ~5 cereri/sec; creșteți pe planuri plătite.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={rateLimitPerSecond}
              onChange={(e) => setRateLimitPerSecond(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Cache TTL (ore)
              <InfoTooltip title="Cache TTL Serper" side="bottom" portalToBody>
                Cât timp se păstrează rezultatele căutărilor în cache înainte de reîmprospătare.
                Cache-ul reduce costurile și accelerează căutările repetate. De exemplu, cu TTL de
                24h, căutarea aceluiași produs de 2 ori într-o zi folosește un singur credit. Sfat:
                24 ore e optim; 0 dezactivează cache-ul.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={0}
              max={168}
              value={cacheTtlHours}
              onChange={(e) => setCacheTtlHours(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
            <span className="text-xs text-muted dark:text-slate-400">Recomandat: 24 ore.</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Alertă buget:{' '}
              {(budgetAlertThreshold * 100).toLocaleString('ro-RO', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
              %
              <InfoTooltip title="Alertă buget Serper" side="bottom" portalToBody>
                La ce procent din bugetul zilnic primiți o avertizare vizuală. Ajută la evitarea
                opririi bruște a căutărilor la atingerea limitei. De exemplu, la 80% cu buget de
                100, alerta apare după 80 de cereri. Sfat: setează la 80–90% pentru a avea timp să
                reacționezi.
              </InfoTooltip>
            </span>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={budgetAlertThreshold}
              onChange={(e) => setBudgetAlertThreshold(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări Serper'}
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
            onClick={() => void testConnection()}
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
                ? `Conexiune OK (${(healthResult.responseTimeMs ?? 0).toLocaleString('ro-RO')} ms)`
                : healthResult.status === 'disabled'
                  ? 'Serper dezactivat'
                  : healthResult.status === 'missing_key'
                    ? 'API key lipsă'
                    : (healthResult.message ?? 'Eroare conexiune')}
            </span>
          ) : null}
        </div>
        {!canSave && !isConnected ? (
          <div className="text-xs text-warning dark:text-amber-400">
            Pentru a salva conexiunea, testează mai întâi conexiunea Serper.
          </div>
        ) : null}
        {connectionStatus && connectionStatus !== 'unknown' ? (
          <div className="text-xs text-muted dark:text-slate-400">
            Status conexiune: {CONNECTION_STATUS_LABELS[connectionStatus]}
            {lastCheckedAt ? ` · verificat ${new Date(lastCheckedAt).toLocaleString('ro-RO')}` : ''}
            {lastSuccessAt ? ` · succes ${new Date(lastSuccessAt).toLocaleString('ro-RO')}` : ''}
            {lastError ? ` · ${lastError}` : ''}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm dark:border-emerald-700/50 dark:bg-emerald-900/20">
            Setările Serper au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
