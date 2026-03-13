import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  DeepSeekHealthResponse,
  DeepSeekSettingsResponse,
  DeepSeekSettingsUpdateRequest,
} from '@app/types';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { TextField } from '../components/ui/text-field';
import { Select, type SelectOption } from '../components/ui/select';
import { SubmitButton } from '../components/forms/submit-button';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Slider } from '../components/ui/slider';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';

type DeepSeekConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

const STATUS_LABELS: Record<DeepSeekConnectionStatus, string> = {
  unknown: 'necunoscut',
  connected: 'conectat',
  error: 'eroare',
  disabled: 'dezactivat',
  missing_key: 'cheie lipsă',
  pending: 'în așteptare',
};

const STATUS_STYLES: Record<DeepSeekConnectionStatus, string> = {
  unknown: 'bg-muted/20 text-muted',
  connected: 'bg-success/15 text-success',
  error: 'bg-error/15 text-error',
  disabled: 'bg-warning/15 text-warning',
  missing_key: 'bg-warning/15 text-warning',
  pending: 'bg-primary/15 text-primary',
};

function normalizeStatus(
  value: DeepSeekSettingsResponse['connectionStatus']
): DeepSeekConnectionStatus {
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

export default function SettingsDeepSeek() {
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
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
  const [todayUsage, setTodayUsage] = useState<DeepSeekSettingsResponse['todayUsage'] | undefined>(
    undefined
  );
  const [connectionStatus, setConnectionStatus] = useState<DeepSeekConnectionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<DeepSeekHealthResponse | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getApi<DeepSeekSettingsResponse>('/settings/deepseek');
        if (cancelled) return;
        setEnabled(data.enabled);
        setBaseUrl(data.baseUrl ?? '');
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
            err instanceof Error ? err.message : 'Nu am putut încărca setările DeepSeek.';
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
      let data: DeepSeekHealthResponse;
      if (trimmedKey) {
        data = await api.postApi<DeepSeekHealthResponse, { apiKey: string }>(
          '/settings/deepseek/health',
          {
            apiKey: trimmedKey,
          }
        );
      } else if (hasApiKey) {
        data = await api.postApi<DeepSeekHealthResponse, { useStoredKey: true }>(
          '/settings/deepseek/health',
          { useStoredKey: true }
        );
      } else {
        data = await api.getApi<DeepSeekHealthResponse>('/settings/deepseek/health');
      }
      setHealthResult(data);
      if (data.status === 'ok' && data.availableModels?.length) {
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
        message: err instanceof Error ? err.message : 'Testul conexiunii DeepSeek a eșuat.',
      });
      setLastTestedKey(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      setError('Testează conexiunea înainte de a salva setările DeepSeek.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: DeepSeekSettingsUpdateRequest = {
        enabled,
        baseUrl: baseUrl || null,
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
      const data = await api.putApi<DeepSeekSettingsResponse, Record<string, unknown>>(
        '/settings/deepseek',
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
      const message = err instanceof Error ? err.message : 'Salvarea setărilor DeepSeek a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const disconnectConnection = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: DeepSeekSettingsUpdateRequest = {
        enabled: false,
        apiKey: '',
      };
      const data = await api.putApi<DeepSeekSettingsResponse, Record<string, unknown>>(
        '/settings/deepseek',
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
      const message = err instanceof Error ? err.message : 'Deconectarea DeepSeek a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Se încarcă setările DeepSeek..." />;

  return (
    <div className="space-y-4">
      {error ? <ErrorState message={error} /> : null}

      <Card className="p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
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
      </Card>

      {todayUsage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm text-muted">Cereri azi</div>
            <div className="mt-1 text-2xl font-semibold">
              {todayUsage.requests.toLocaleString('ro-RO')}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted">Tokeni intrare</div>
            <div className="mt-1 text-2xl font-semibold">
              {todayUsage.inputTokens.toLocaleString('ro-RO')}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted">Buget utilizat</div>
            <div className="mt-1 text-2xl font-semibold">
              {(todayUsage.percentUsed * 100).toLocaleString('ro-RO', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
              %
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted/10">
              <div
                className="h-2 rounded-full bg-primary/60"
                style={{ width: `${budgetPercent * 100}%` }}
              />
            </div>
          </Card>
        </div>
      ) : null}

      <form onSubmit={(event) => void saveSettings(event)} className="space-y-4">
        <label className="flex items-center gap-2 text-foreground">
          <Checkbox
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
          />
          Activează DeepSeek
          <InfoTooltip title="Activează DeepSeek" side="bottom" portalToBody>
            Activează sau dezactivează integrarea DeepSeek. DeepSeek oferă modele foarte economice
            cu performanță competitivă, ideale pentru procesare în volum mare. Sfat: DeepSeek V3.2
            este cu până la 95% mai ieftin decât GPT-4o.
          </InfoTooltip>
        </label>

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="deepseek-api-key"
          >
            Cheie API DeepSeek
            <InfoTooltip title="Cheie API DeepSeek" side="bottom" portalToBody>
              Cheia de acces la API-ul DeepSeek. Obțineți o cheie din platform.deepseek.com. Format:
              „sk-...". Sfat: cheia e stocată criptat.
            </InfoTooltip>
          </label>
          <TextField
            id="deepseek-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyDirty(true);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
            placeholder={hasApiKey ? '••••••••' : 'sk-...'}
          />
          <p className="mt-1 text-xs text-muted">Cheia este stocată criptat în baza de date.</p>
        </div>

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="deepseek-base-url"
          >
            URL bază DeepSeek (opțional)
            <InfoTooltip title="URL bază DeepSeek" side="bottom" portalToBody>
              Adresa serverului API DeepSeek — lăsați gol pentru API-ul oficial. Completați doar
              dacă folosiți un proxy. Sfat: URL-ul trebuie să includă protocol.
            </InfoTooltip>
          </label>
          <TextField
            id="deepseek-base-url"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.deepseek.com"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Model
              <InfoTooltip title="Model DeepSeek" side="bottom" portalToBody>
                Modelul DeepSeek folosit. deepseek-chat e rapid și economic; deepseek-reasoner are
                mod de raționament avansat. Sfat: lista se actualizează după testul conexiunii.
              </InfoTooltip>
            </span>
            <Select
              options={availableModels.map((item): SelectOption => ({ value: item, label: item }))}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Tokeni max per cerere
              <InfoTooltip title="Tokeni max per cerere" side="bottom" portalToBody>
                Limita maximă de tokeni pentru răspunsul modelului la o singură cerere. Valori mai
                mari permit răspunsuri mai detaliate dar cresc costul per cerere. De exemplu,
                extragerea specificațiilor unui laptop necesită ~1500 tokeni. Sfat: 2000–4000 e
                suficient pentru majoritatea produselor.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={256}
              max={8000}
              value={String(maxTokens)}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
            />
          </div>
        </div>

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="deepseek-temperature"
          >
            Temperatură:{' '}
            {temperature.toLocaleString('ro-RO', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <InfoTooltip title="Temperatură DeepSeek" side="bottom" portalToBody>
              Controlul aleatoriei în răspunsurile modelului. 0 = determinist maxim, ideal pentru
              extracție structurată unde vrei consistență. Valori mai mari (0,5–0,7) produc
              răspunsuri mai variate. De exemplu, la 0,1 aceleași date de intrare produc mereu
              același JSON. Sfat: 0,1 e recomandat pentru reproductibilitate.
            </InfoTooltip>
          </label>
          <Slider
            id="deepseek-temperature"
            min={0}
            max={1}
            step={0.01}
            value={temperature}
            showValue={false}
            onChange={(val) => setTemperature(val)}
            className="mt-2"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Limită rată (cereri/min)
              <InfoTooltip title="Limită rată DeepSeek" side="bottom" portalToBody>
                Câte cereri se pot trimite pe minut către DeepSeek API. Protejează contra depășirii
                limitelor API și a costurilor neprevăzute. De exemplu, 60 cereri/min procesează ~1
                produs/secundă. Sfat: 60 cereri/min e un echilibru bun; creșteți pentru volume mari
                de procesare.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={1}
              max={1000}
              value={String(rateLimit)}
              onChange={(event) => setRateLimit(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Buget zilnic
              <InfoTooltip title="Buget zilnic DeepSeek" side="bottom" portalToBody>
                Numărul maxim de cereri către DeepSeek pe zi. La atingerea limitei, procesarea se
                oprește automat până a doua zi. De exemplu, cu 1000 cereri/zi poți procesa ~1000
                pagini de produs. Sfat: ajustează în funcție de volumul catalogului tău.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={0}
              max={100000}
              value={String(dailyBudget)}
              onChange={(event) => setDailyBudget(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Prag alertă buget
              <InfoTooltip title="Prag alertă buget DeepSeek" side="bottom" portalToBody>
                Procentul din bugetul zilnic la care primești o avertizare vizuală. Te ajută să
                reacționezi înainte de atingerea limitei absolute. De exemplu, la 0,8 cu buget de
                1000, alerta apare după 800 cereri. Sfat: setează la 80–90% pentru marjă suficientă.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={0.5}
              max={0.99}
              step={0.01}
              value={String(budgetAlertThreshold)}
              onChange={(event) => setBudgetAlertThreshold(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări DeepSeek'}
          </SubmitButton>
          {isConnected ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void disconnectConnection()}
              disabled={saving}
            >
              Deconectează
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void testHealth()}
            disabled={!hasApiKey && !apiKeyDirty}
            loading={healthLoading}
          >
            {healthLoading ? 'Se testează...' : 'Test conexiune'}
          </Button>
          {healthResult ? (
            <span
              className={`text-xs ${healthResult.status === 'ok' ? 'text-success' : 'text-error'}`}
            >
              {healthResult.status === 'ok'
                ? `Conexiune OK (${(healthResult.latencyMs ?? 0).toLocaleString('ro-RO')} ms)`
                : healthResult.status === 'disabled'
                  ? 'DeepSeek dezactivat'
                  : healthResult.status === 'missing_key'
                    ? 'API key lipsă'
                    : (healthResult.message ?? 'Eroare conexiune')}
            </span>
          ) : null}
        </div>

        {!canSave && !isConnected ? (
          <div className="text-xs text-warning">
            Pentru a salva conexiunea, testează mai întâi conexiunea DeepSeek.
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-[var(--shadow-sm)]">
            Setările DeepSeek au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
