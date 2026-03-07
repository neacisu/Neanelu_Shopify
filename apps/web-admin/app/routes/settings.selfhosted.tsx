import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  SelfHostedEndpoint,
  SelfHostedHealthResponse,
  SelfHostedSettingsResponse,
  SelfHostedSettingsUpdateRequest,
} from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Button } from '../components/ui/button';
import { useApiClient } from '../hooks/use-api';

function createEmptyEndpoint(): SelfHostedEndpoint {
  return {
    id: crypto.randomUUID(),
    label: '',
    baseUrl: '',
    modelId: '',
    type: 'chat',
    enabled: true,
    maxConcurrentRequests: 1,
    timeoutMs: 20000,
  };
}

export default function SettingsSelfHosted() {
  const api = useApiClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [bearerToken, setBearerToken] = useState('');
  const [bearerTokenDirty, setBearerTokenDirty] = useState(false);
  const [hasBearerToken, setHasBearerToken] = useState(false);
  const [endpoints, setEndpoints] = useState<SelfHostedEndpoint[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<SelfHostedHealthResponse | null>(null);
  const [gpuMetricsText, setGpuMetricsText] = useState<string>('Fără metrici GPU detectate');

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getApi<SelfHostedSettingsResponse>('/settings/selfhosted');
        if (cancelled) return;
        setEnabled(data.enabled);
        setHasBearerToken(data.hasBearerToken);
        setEndpoints(data.endpoints ?? []);
        setConnectionStatus(data.connectionStatus);
        setLastCheckedAt(data.lastCheckedAt ?? null);
        setLastSuccessAt(data.lastSuccessAt ?? null);
        setLastError(data.lastError ?? null);
        setGpuMetricsText(
          data.gpuMetrics
            ? [
                data.gpuMetrics.gpuUtilizationPercent != null
                  ? `GPU ${data.gpuMetrics.gpuUtilizationPercent.toFixed(0)}%`
                  : null,
                data.gpuMetrics.temperatureCelsius != null
                  ? `${data.gpuMetrics.temperatureCelsius.toFixed(0)}°C`
                  : null,
                data.gpuMetrics.vramUsedGiB != null && data.gpuMetrics.vramTotalGiB != null
                  ? `${data.gpuMetrics.vramUsedGiB.toFixed(1)}/${data.gpuMetrics.vramTotalGiB.toFixed(1)} GiB`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Fără metrici GPU detectate'
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Nu am putut încărca setările selfhosted.');
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

  const testConnection = async () => {
    setHealthLoading(true);
    setHealthResult(null);
    try {
      const response = await api.postApi<
        SelfHostedHealthResponse,
        { bearerToken?: string; endpoints: SelfHostedEndpoint[]; useStoredToken?: boolean }
      >('/settings/selfhosted/health', {
        ...(bearerTokenDirty && bearerToken.trim().length > 0
          ? { bearerToken: bearerToken.trim() }
          : {}),
        ...(hasBearerToken && !bearerTokenDirty ? { useStoredToken: true } : {}),
        endpoints,
      });
      setHealthResult(response);
    } catch (err) {
      setHealthResult({
        status: 'error',
        checkedAt: new Date().toISOString(),
        endpoints: {},
        gpuMetrics: null,
      });
      setError(err instanceof Error ? err.message : 'Testul conexiunii a eșuat.');
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: SelfHostedSettingsUpdateRequest = {
        enabled,
        endpoints,
      };
      if (bearerTokenDirty) {
        payload.bearerToken = bearerToken;
      }
      const data = await api.putApi<SelfHostedSettingsResponse, SelfHostedSettingsUpdateRequest>(
        '/settings/selfhosted',
        payload
      );
      setHasBearerToken(data.hasBearerToken);
      setConnectionStatus(data.connectionStatus);
      setLastCheckedAt(data.lastCheckedAt ?? null);
      setLastSuccessAt(data.lastSuccessAt ?? null);
      setLastError(data.lastError ?? null);
      setBearerToken('');
      setBearerTokenDirty(false);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salvarea setărilor selfhosted a eșuat.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Se încarcă setările selfhosted...
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
          <span className="rounded-full bg-muted/20 px-2 py-1 font-medium dark:bg-slate-700/40">
            {connectionStatus}
          </span>
          {lastCheckedAt ? (
            <span>verificat {new Date(lastCheckedAt).toLocaleString('ro-RO')}</span>
          ) : null}
          {lastSuccessAt ? (
            <span>succes {new Date(lastSuccessAt).toLocaleString('ro-RO')}</span>
          ) : null}
        </div>
        {lastError ? <div className="mt-1 text-xs text-error">{lastError}</div> : null}
        <div className="mt-2 text-xs text-muted dark:text-slate-400">{gpuMetricsText}</div>
      </div>

      <form onSubmit={(event) => void saveSettings(event)} className="space-y-4">
        <label className="flex items-center gap-2 text-body dark:text-slate-200">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Activează self-hosted LLM
          <InfoTooltip title="Activare self-hosted" side="bottom" portalToBody>
            Activează endpointurile vLLM interne pentru taskuri de chat/completions. Auditul live a
            confirmat modele chat funcționale și a confirmat că embeddings selfhosted nu sunt
            disponibile în configurația curentă.
          </InfoTooltip>
        </label>

        <div>
          <label
            className="text-caption text-muted dark:text-slate-400 inline-flex items-center gap-1"
            htmlFor="selfhosted-token"
          >
            Bearer token (opțional)
            <InfoTooltip title="Bearer token self-hosted" side="bottom" portalToBody>
              Tokenul este opțional. Dacă proxy-ul intern expune endpointurile fără autentificare,
              lăsați câmpul gol. Dacă există, este stocat criptat AES-256-GCM.
            </InfoTooltip>
          </label>
          <input
            id="selfhosted-token"
            type="password"
            value={bearerToken}
            onChange={(event) => {
              setBearerToken(event.target.value);
              setBearerTokenDirty(true);
            }}
            placeholder={hasBearerToken ? '••••••••' : 'Bearer token'}
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-body dark:text-slate-200">Endpointuri</div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEndpoints((prev) => [...prev, createEmptyEndpoint()])}
            >
              Adaugă endpoint
            </Button>
          </div>

          <div className="rounded-md border border-amber-300/40 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-200">
            Audit live: `Qwen/QwQ-32B-AWQ` și `Qwen/Qwen2.5-14B-Instruct-AWQ` răspund pe chat, dar
            `/v1/embeddings` răspunde `404`. Tipul de endpoint permis în această versiune este doar
            `chat`.
          </div>

          {endpoints.length === 0 ? (
            <div className="rounded-md border border-dashed border-muted/30 p-4 text-sm text-muted dark:border-slate-700 dark:text-slate-400">
              Nu există endpointuri configurate.
            </div>
          ) : null}

          {endpoints.map((endpoint, index) => {
            const health = healthResult?.endpoints[endpoint.id];
            return (
              <div
                key={endpoint.id}
                className="rounded-lg border border-muted/20 p-4 dark:border-slate-700 dark:bg-slate-900/80"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted dark:text-slate-400">Label</span>
                    <input
                      type="text"
                      value={endpoint.label}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, label: event.target.value };
                        setEndpoints(next);
                      }}
                      className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted dark:text-slate-400">Base URL</span>
                    <input
                      type="text"
                      value={endpoint.baseUrl}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, baseUrl: event.target.value };
                        setEndpoints(next);
                      }}
                      placeholder="http://10.0.1.13:8000"
                      className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted dark:text-slate-400">Model ID exact</span>
                    <input
                      type="text"
                      value={endpoint.modelId}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, modelId: event.target.value };
                        setEndpoints(next);
                      }}
                      placeholder="Qwen/QwQ-32B-AWQ"
                      className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted dark:text-slate-400">Concurență</span>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={endpoint.maxConcurrentRequests}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = {
                            ...endpoint,
                            maxConcurrentRequests: Number(event.target.value),
                          };
                          setEndpoints(next);
                        }}
                        className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted dark:text-slate-400">Timeout ms</span>
                      <input
                        type="number"
                        min={1000}
                        max={120000}
                        value={endpoint.timeoutMs}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = { ...endpoint, timeoutMs: Number(event.target.value) };
                          setEndpoints(next);
                        }}
                        className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      />
                    </label>
                    <label className="flex items-end gap-2 text-sm text-body dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={endpoint.enabled}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = { ...endpoint, enabled: event.target.checked };
                          setEndpoints(next);
                        }}
                        className="size-4 accent-primary"
                      />
                      Activ
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted dark:text-slate-400">
                  <span>Status: {health?.status ?? 'nevalidat'}</span>
                  {health?.latencyMs != null ? <span>Latență: {health.latencyMs} ms</span> : null}
                  {health?.modelsLoaded?.length ? (
                    <span>Modele: {health.modelsLoaded.join(', ')}</span>
                  ) : null}
                </div>

                <div className="mt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setEndpoints((prev) => prev.filter((item) => item.id !== endpoint.id))
                    }
                  >
                    Elimină endpoint
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState}>Salvează setări selfhosted</SubmitButton>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void testConnection()}
            disabled={healthLoading || endpoints.length === 0}
          >
            {healthLoading ? 'Se testează...' : 'Test conexiune'}
          </Button>
        </div>

        {healthResult ? (
          <div className="rounded-md border border-muted/20 bg-muted/5 p-3 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Rezultat health: {healthResult.status}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm dark:border-emerald-700/50 dark:bg-emerald-900/20">
            Setările selfhosted au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
