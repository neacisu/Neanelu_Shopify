import { useEffect, useMemo, useState } from 'react';

import type {
  SelfHostedEndpoint,
  SelfHostedHealthResponse,
  SelfHostedSettingsResponse,
  SelfHostedSettingsUpdateRequest,
} from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { ErrorState } from '../components/patterns/error-state';
import { EmptyState } from '../components/patterns/empty-state';
import { LoadingState } from '../components/patterns/loading-state';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { TextField } from '../components/ui/text-field';
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

function formatGpuMetricsText(data: SelfHostedSettingsResponse): string {
  const metrics = data.gpuMetrics;
  if (!metrics) return 'Fără metrici GPU detectate';

  const parts: string[] = [];
  if (metrics.gpuUtilizationPercent != null) {
    parts.push(`GPU ${metrics.gpuUtilizationPercent.toFixed(0)}%`);
  }
  if (metrics.temperatureCelsius != null) {
    parts.push(`${metrics.temperatureCelsius.toFixed(0)}°C`);
  }
  if (metrics.vramUsedGiB != null && metrics.vramTotalGiB != null) {
    parts.push(`${metrics.vramUsedGiB.toFixed(1)}/${metrics.vramTotalGiB.toFixed(1)} GiB`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Fără metrici GPU detectate';
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
        setGpuMetricsText(formatGpuMetricsText(data));
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
      const payload: {
        bearerToken?: string;
        endpoints: SelfHostedEndpoint[];
        useStoredToken?: boolean;
      } = { endpoints };
      const trimmedBearerToken = bearerToken.trim();
      if (bearerTokenDirty && trimmedBearerToken.length > 0) {
        payload.bearerToken = trimmedBearerToken;
      } else if (hasBearerToken && !bearerTokenDirty) {
        payload.useStoredToken = true;
      }

      const response = await api.postApi<
        SelfHostedHealthResponse,
        { bearerToken?: string; endpoints: SelfHostedEndpoint[]; useStoredToken?: boolean }
      >('/settings/selfhosted/health', payload);
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

  const saveSettings = async (event: { preventDefault: () => void }): Promise<void> => {
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

  const onSaveSettingsSubmit = (event: { preventDefault: () => void }): void => {
    void saveSettings(event);
  };

  const onTestConnectionClick = (): void => {
    void testConnection();
  };

  const removeEndpoint = (id: string): void => {
    setEndpoints((prev) => prev.filter((item) => item.id !== id));
  };

  if (loading) return <LoadingState label="Se încarcă setările selfhosted..." />;

  return (
    <div className="space-y-4">
      {error ? <ErrorState message={error} /> : null}

      <div className="rounded-lg border border-border bg-background p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Status conexiune</span>
          <span className="rounded-full bg-muted/20 px-2 py-1 font-medium">{connectionStatus}</span>
          {lastCheckedAt ? (
            <span>verificat {new Date(lastCheckedAt).toLocaleString('ro-RO')}</span>
          ) : null}
          {lastSuccessAt ? (
            <span>succes {new Date(lastSuccessAt).toLocaleString('ro-RO')}</span>
          ) : null}
        </div>
        {lastError ? <div className="mt-1 text-xs text-error">{lastError}</div> : null}
        <div className="mt-2 text-xs text-muted">{gpuMetricsText}</div>
      </div>

      <form onSubmit={onSaveSettingsSubmit} className="space-y-4">
        <label className="flex items-center gap-2 text-foreground">
          <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Activează self-hosted LLM
          <InfoTooltip title="Activare self-hosted" side="bottom" portalToBody>
            Activează endpointurile vLLM interne pentru taskuri de chat/completions. Auditul live a
            confirmat modele chat funcționale și a confirmat că embeddings selfhosted nu sunt
            disponibile în configurația curentă.
          </InfoTooltip>
        </label>

        <div>
          <label
            className="text-caption text-muted inline-flex items-center gap-1"
            htmlFor="selfhosted-token"
          >
            Bearer token (opțional)
            <InfoTooltip title="Bearer token self-hosted" side="bottom" portalToBody>
              Tokenul este opțional. Dacă proxy-ul intern expune endpointurile fără autentificare,
              lăsați câmpul gol. Dacă există, este stocat criptat AES-256-GCM.
            </InfoTooltip>
          </label>
          <TextField
            id="selfhosted-token"
            type="password"
            value={bearerToken}
            onChange={(event) => {
              setBearerToken(event.target.value);
              setBearerTokenDirty(true);
            }}
            placeholder={hasBearerToken ? '••••••••' : 'Bearer token'}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">Endpointuri</div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEndpoints((prev) => [...prev, createEmptyEndpoint()])}
            >
              Adaugă endpoint
            </Button>
          </div>

          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
            Audit live: `Qwen/QwQ-32B-AWQ` și `Qwen/Qwen2.5-14B-Instruct-AWQ` răspund pe chat, dar
            `/v1/embeddings` răspunde `404`. Tipul de endpoint permis în această versiune este doar
            `chat`.
          </div>

          {endpoints.length === 0 ? (
            <EmptyState
              title="Niciun endpoint configurat"
              description="Nu există endpointuri self-hosted configurate."
            />
          ) : null}

          {endpoints.map((endpoint, index) => {
            const health = healthResult?.endpoints[endpoint.id];
            return (
              <div key={endpoint.id} className="rounded-lg border border-border p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted">Label</span>
                    <TextField
                      type="text"
                      value={endpoint.label}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, label: event.target.value };
                        setEndpoints(next);
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted">Base URL</span>
                    <TextField
                      type="text"
                      value={endpoint.baseUrl}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, baseUrl: event.target.value };
                        setEndpoints(next);
                      }}
                      placeholder="http://10.0.1.13:8000"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted">Model ID exact</span>
                    <TextField
                      type="text"
                      value={endpoint.modelId}
                      onChange={(event) => {
                        const next = [...endpoints];
                        next[index] = { ...endpoint, modelId: event.target.value };
                        setEndpoints(next);
                      }}
                      placeholder="Qwen/QwQ-32B-AWQ"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-muted">Concurență</span>
                      <TextField
                        type="number"
                        min={1}
                        max={32}
                        value={String(endpoint.maxConcurrentRequests)}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = {
                            ...endpoint,
                            maxConcurrentRequests: Number(event.target.value),
                          };
                          setEndpoints(next);
                        }}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-muted">Timeout ms</span>
                      <TextField
                        type="number"
                        min={1000}
                        max={120000}
                        value={String(endpoint.timeoutMs)}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = { ...endpoint, timeoutMs: Number(event.target.value) };
                          setEndpoints(next);
                        }}
                      />
                    </label>
                    <label className="flex items-end gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={endpoint.enabled}
                        onChange={(event) => {
                          const next = [...endpoints];
                          next[index] = { ...endpoint, enabled: event.target.checked };
                          setEndpoints(next);
                        }}
                      />
                      <span>Activ</span>
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>Status: {health?.status ?? 'nevalidat'}</span>
                  {health?.latencyMs == null ? null : <span>Latență: {health.latencyMs} ms</span>}
                  {health?.modelsLoaded != null && health.modelsLoaded.length > 0 ? (
                    <span>Modele: {health.modelsLoaded.join(', ')}</span>
                  ) : null}
                </div>

                <div className="mt-3">
                  <Button type="button" variant="ghost" onClick={() => removeEndpoint(endpoint.id)}>
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
            onClick={onTestConnectionClick}
            disabled={healthLoading || endpoints.length === 0}
          >
            {healthLoading ? 'Se testează...' : 'Test conexiune'}
          </Button>
        </div>

        {healthResult ? (
          <div className="rounded-md border border-muted/20 bg-muted/5 p-3 text-sm text-muted">
            Rezultat health: {healthResult.status}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-(--shadow-sm)">
            Setările selfhosted au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
