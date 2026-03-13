import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  SerperHealthResponse,
  SerperSettingsResponse,
  SerperSettingsUpdateRequest,
} from '@app/types';

import { InfoTooltip } from '../components/ui/info-tooltip';
import { TextField } from '../components/ui/text-field';
import { SubmitButton } from '../components/forms/submit-button';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Slider } from '../components/ui/slider';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
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
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4">
        <h3 className="font-medium text-foreground">Serper API - Cautare externa produse</h3>
        <p className="mt-1 text-sm text-muted">
          Configurează integrarea cu Serper API pentru căutarea externă de produse (Golden Record
          Stage 4). Obține un API key gratuit de la{' '}
          <a
            href="https://serper.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            serper.dev
          </a>{' '}
          (2500 queries gratuite).
        </p>
      </div>

      {loading ? <LoadingState label="Se încarcă setările Serper..." /> : null}

      {error ? <ErrorState message={error} /> : null}

      {todayUsage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm text-muted">Cereri azi</div>
            <div className="mt-1 text-2xl font-semibold">
              {todayUsage.requests.toLocaleString('ro-RO')}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted">Cost estimat</div>
            <div className="mt-1 text-2xl font-semibold">
              {todayUsage.cost.toLocaleString('ro-RO', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}{' '}
              USD
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
            {todayUsage.percentUsed >= budgetAlertThreshold ? (
              <div className="mt-1 text-xs text-warning">Aproape de limita zilnică!</div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <form onSubmit={(e) => void saveSettings(e)} className="space-y-4">
        <label className="flex items-center gap-2 text-foreground">
          <Checkbox
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
            className="text-caption text-muted inline-flex items-center gap-1"
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
          <TextField
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
          />
          <p className="mt-1 text-xs text-muted">Cheia este stocată criptat în baza de date.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Buget zilnic (cereri)
              <InfoTooltip title="Buget zilnic Serper" side="bottom" portalToBody>
                Numărul maxim de cereri către Serper pe zi. Limita protejează contra depășirii
                costurilor, mai ales pe planuri plătite. De exemplu, cu 100 cereri/zi poți căuta
                informații pentru ~100 produse. Sfat: Serper oferă 2500 cereri gratuite lunar —
                ajustați bugetul zilnic corespunzător.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={1}
              max={100000}
              value={String(dailyBudget)}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Limită rată (cereri/sec)
              <InfoTooltip title="Limită rată Serper" side="bottom" portalToBody>
                Câte cereri se pot trimite pe secundă către Serper API. Valori mai mici reduc riscul
                de blocare de către Google. De exemplu, 10 cereri/sec procesează 600 produse pe
                minut. Sfat: planul gratuit suportă ~5 cereri/sec; creșteți pe planuri plătite.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={1}
              max={100}
              value={String(rateLimitPerSecond)}
              onChange={(e) => setRateLimitPerSecond(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Cache TTL (ore)
              <InfoTooltip title="Cache TTL Serper" side="bottom" portalToBody>
                Cât timp se păstrează rezultatele căutărilor în cache înainte de reîmprospătare.
                Cache-ul reduce costurile și accelerează căutările repetate. De exemplu, cu TTL de
                24h, căutarea aceluiași produs de 2 ori într-o zi folosește un singur credit. Sfat:
                24 ore e optim; 0 dezactivează cache-ul.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={0}
              max={168}
              value={String(cacheTtlHours)}
              onChange={(e) => setCacheTtlHours(Number(e.target.value))}
            />
            <span className="text-xs text-muted">Recomandat: 24 ore.</span>
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
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
            <Slider
              min={0.5}
              max={0.99}
              step={0.01}
              value={budgetAlertThreshold}
              showValue={false}
              onChange={(val) => setBudgetAlertThreshold(val)}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări Serper'}
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
            onClick={() => void testConnection()}
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
          <div className="text-xs text-warning">
            Pentru a salva conexiunea, testează mai întâi conexiunea Serper.
          </div>
        ) : null}
        {connectionStatus && connectionStatus !== 'unknown' ? (
          <div className="text-xs text-muted">
            Status conexiune: {CONNECTION_STATUS_LABELS[connectionStatus]}
            {lastCheckedAt ? ` · verificat ${new Date(lastCheckedAt).toLocaleString('ro-RO')}` : ''}
            {lastSuccessAt ? ` · succes ${new Date(lastSuccessAt).toLocaleString('ro-RO')}` : ''}
            {lastError ? ` · ${lastError}` : ''}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-[var(--shadow-sm)]">
            Setările Serper au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
