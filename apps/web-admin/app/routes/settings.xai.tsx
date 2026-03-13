import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { XaiHealthResponse, XaiSettingsResponse, XaiSettingsUpdateRequest } from '@app/types';

import { InfoTooltip } from '../components/ui/info-tooltip';
import { TextField } from '../components/ui/text-field';
import { Select, type SelectOption } from '../components/ui/select';
import { SubmitButton } from '../components/forms/submit-button';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Slider } from '../components/ui/slider';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';

type XaiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

const STATUS_LABELS: Record<XaiConnectionStatus, string> = {
  unknown: 'necunoscut',
  connected: 'conectat',
  error: 'eroare',
  disabled: 'dezactivat',
  missing_key: 'cheie lipsă',
  pending: 'în așteptare',
};

const STATUS_STYLES: Record<XaiConnectionStatus, string> = {
  unknown: 'bg-muted/20 text-muted',
  connected: 'bg-success/15 text-success',
  error: 'bg-error/15 text-error',
  disabled: 'bg-warning/15 text-warning',
  missing_key: 'bg-warning/15 text-warning',
  pending: 'bg-primary/15 text-primary',
};

function normalizeStatus(value: XaiSettingsResponse['connectionStatus']): XaiConnectionStatus {
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

export default function SettingsXai() {
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
  const [todayUsage, setTodayUsage] = useState<XaiSettingsResponse['todayUsage'] | undefined>(
    undefined
  );
  const [connectionStatus, setConnectionStatus] = useState<XaiConnectionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<XaiHealthResponse | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getApi<XaiSettingsResponse>('/settings/xai');
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
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Nu am putut încărca setările xAI Grok.';
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
      let data: XaiHealthResponse;
      if (trimmedKey) {
        data = await api.postApi<XaiHealthResponse, { apiKey: string }>('/settings/xai/health', {
          apiKey: trimmedKey,
        });
      } else if (hasApiKey) {
        data = await api.postApi<XaiHealthResponse, { useStoredKey: true }>(
          '/settings/xai/health',
          { useStoredKey: true }
        );
      } else {
        data = await api.getApi<XaiHealthResponse>('/settings/xai/health');
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
    } catch (error) {
      setHealthResult({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Testul conexiunii xAI a eșuat.',
      });
      setLastTestedKey(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      setError('Testează conexiunea înainte de a salva setările xAI.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: XaiSettingsUpdateRequest = {
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
      const data = await api.putApi<XaiSettingsResponse, Record<string, unknown>>(
        '/settings/xai',
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea setărilor xAI a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const disconnectConnection = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: XaiSettingsUpdateRequest = {
        enabled: false,
        apiKey: '',
      };
      const data = await api.putApi<XaiSettingsResponse, Record<string, unknown>>(
        '/settings/xai',
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deconectarea xAI a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Se încarcă setările xAI Grok..." />;

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
          Activează xAI Grok pentru AI Auditor
        </label>

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="xai-api-key"
          >
            Cheie API xAI
            <InfoTooltip title="Cheie API xAI Grok" side="bottom" portalToBody>
              Cheia de acces la API-ul xAI pentru AI Auditor și extracția structurată de date din
              pagini web. Obțineți o cheie din contul xAI (console.x.ai). De exemplu, format:
              „xai-abc123...". Sfat: cheia e stocată criptat; lăsați câmpul gol dacă e deja salvată.
            </InfoTooltip>
          </label>
          <TextField
            id="xai-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyDirty(true);
              setHealthResult(null);
              setLastTestedKey(null);
            }}
            placeholder={hasApiKey ? '••••••••' : 'xai-...'}
          />
          <p className="mt-1 text-xs text-muted">Cheia este stocată criptat în baza de date.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Model
              <InfoTooltip title="Model xAI" side="bottom" portalToBody>
                Modelul Grok folosit pentru AI Auditor și extracția structurată de date din paginile
                scrappate. grok-2-mini e rapid și economic; grok-3 e mai precis pentru validări
                complexe. De exemplu, grok-2-mini procesează o pagină în ~2 secunde. Sfat: lista se
                actualizează după testul conexiunii.
              </InfoTooltip>
            </span>
            <Select
              options={availableModels.map((item): SelectOption => ({ value: item, label: item }))}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <p className="text-xs text-muted">Folosit pentru AI Audit și extracție.</p>
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
            htmlFor="xai-temperature"
          >
            Temperatură:{' '}
            {temperature.toLocaleString('ro-RO', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <InfoTooltip title="Temperatură xAI" side="bottom" portalToBody>
              Controlul aleatoriei în răspunsurile modelului. 0 = determinist maxim, ideal pentru
              extracție structurată unde vrei consistență. Valori mai mari (0,5–0,7) produc
              răspunsuri mai variate. De exemplu, la 0,1 aceleași date de intrare produc mereu
              același JSON. Sfat: 0,1 e recomandat pentru reproductibilitate.
            </InfoTooltip>
          </label>
          <Slider
            id="xai-temperature"
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
              <InfoTooltip title="Limită rată xAI" side="bottom" portalToBody>
                Câte cereri se pot trimite pe minut către xAI API. Protejează contra depășirii
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
              <InfoTooltip title="Buget zilnic xAI" side="bottom" portalToBody>
                Numărul maxim de cereri către xAI pe zi. La atingerea limitei, procesarea AI Auditor
                se oprește automat până a doua zi. De exemplu, cu 1000 cereri/zi poți procesa ~1000
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
              <InfoTooltip title="Prag alertă buget xAI" side="bottom" portalToBody>
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

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="xai-base-url"
          >
            URL bază xAI (opțional)
            <InfoTooltip title="URL bază xAI" side="bottom" portalToBody>
              Adresa serverului API xAI — lăsați gol pentru API-ul oficial (https://api.x.ai/v1).
              Completați doar dacă folosiți un proxy sau endpoint alternativ. De exemplu, un proxy
              intern: „https://proxy.intern/xai/v1". Sfat: URL-ul trebuie să includă protocol și
              versiune.
            </InfoTooltip>
          </label>
          <TextField
            id="xai-base-url"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.x.ai/v1"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări xAI'}
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
                  ? 'xAI dezactivat'
                  : healthResult.status === 'missing_key'
                    ? 'API key lipsă'
                    : (healthResult.message ?? 'Eroare conexiune')}
            </span>
          ) : null}
        </div>

        {!canSave && !isConnected ? (
          <div className="text-xs text-warning">
            Pentru a salva conexiunea, testează mai întâi conexiunea xAI.
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-[var(--shadow-sm)]">
            Setările xAI au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
