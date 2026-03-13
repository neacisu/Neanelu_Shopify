import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AiHealthResponse,
  AiSettingsResponse,
  AiSettingsUpdateRequest,
  ModelRoutingResponse,
} from '@app/types';

import { InfoTooltip } from '../components/ui/info-tooltip';
import { SubmitButton } from '../components/forms/submit-button';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Select } from '../components/ui/select';
import { TextField } from '../components/ui/text-field';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';

type OpenAiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

interface AiStateSetters {
  setAiEnabled: (v: boolean) => void;
  setAiBaseUrl: (v: string) => void;
  setAiEmbeddingsModel: (v: string) => void;
  setAiModels: (v: string[]) => void;
  setAiBatchSize: (v: number) => void;
  setAiSimilarityThreshold: (v: number) => void;
  setAiHasApiKey: (v: boolean) => void;
  setTodayUsage: (v: AiSettingsResponse['todayUsage']) => void;
  setConnectionStatus: (v: OpenAiConnectionStatus) => void;
  setLastCheckedAt: (v: string | null) => void;
  setLastSuccessAt: (v: string | null) => void;
  setLastError: (v: string | null) => void;
  setLastTestedKey: (v: string | null) => void;
  setAiHealthResult: (v: AiHealthResponse | null) => void;
  setAiHealthLoading: (v: boolean) => void;
  setAiLoading: (v: boolean) => void;
  setAiError: (v: string | null) => void;
}

async function loadAndApplyAiSettings(
  api: ReturnType<typeof useApiClient>,
  setters: AiStateSetters,
  cancelled: () => boolean
): Promise<void> {
  setters.setAiLoading(true);
  setters.setAiError(null);
  try {
    const data = await api.getApi<AiSettingsResponse>('/settings/ai');
    if (cancelled()) return;
    setters.setAiEnabled(data.enabled);
    setters.setAiBaseUrl(data.openaiBaseUrl ?? '');
    setters.setAiEmbeddingsModel(data.openaiEmbeddingsModel ?? '');
    setters.setAiModels(data.availableModels ?? []);
    setters.setAiBatchSize(data.embeddingBatchSize ?? 100);
    setters.setAiSimilarityThreshold(data.similarityThreshold ?? 0.8);
    setters.setAiHasApiKey(data.hasApiKey);
    setters.setTodayUsage(data.todayUsage);
    const nextStatus = normalizeStatus(data.connectionStatus);
    setters.setConnectionStatus(nextStatus);
    setters.setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
    setters.setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
    setters.setLastError(coerceNullableString(data.lastError));
    if (data.connectionStatus === 'connected' && data.hasApiKey) {
      setters.setLastTestedKey('__stored__');
    } else {
      setters.setLastTestedKey(null);
    }
    setters.setAiHealthResult(null);
  } catch (error) {
    if (!cancelled()) {
      const message =
        error instanceof Error ? error.message : 'Nu am putut încărca setările OpenAI.';
      setters.setAiError(message);
    }
  } finally {
    if (!cancelled()) setters.setAiLoading(false);
  }
}

async function disconnectOpenAiConnection(
  api: ReturnType<typeof useApiClient>,
  setters: Pick<
    AiStateSetters,
    | 'setAiHasApiKey'
    | 'setConnectionStatus'
    | 'setLastCheckedAt'
    | 'setLastSuccessAt'
    | 'setLastError'
    | 'setLastTestedKey'
    | 'setAiHealthResult'
    | 'setAiError'
  > & {
    setAiEnabled: (v: boolean) => void;
    setAiApiKey: (v: string) => void;
    setAiApiKeyDirty: (v: boolean) => void;
    setAiSaving: (v: boolean) => void;
    setAiSuccess: (v: boolean) => void;
  }
): Promise<void> {
  setters.setAiSaving(true);
  setters.setAiError(null);
  try {
    const payload: AiSettingsUpdateRequest = {
      enabled: false,
      apiKey: '',
    };
    const data = await api.putApi<AiSettingsResponse, AiSettingsUpdateRequest>(
      '/settings/ai',
      payload
    );
    setters.setAiEnabled(false);
    setters.setAiHasApiKey(data.hasApiKey);
    setters.setConnectionStatus(normalizeStatus(data.connectionStatus));
    setters.setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
    setters.setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
    setters.setLastError(coerceNullableString(data.lastError));
    setters.setAiApiKey('');
    setters.setAiApiKeyDirty(false);
    setters.setAiHealthResult(null);
    setters.setLastTestedKey(null);
    setters.setAiSuccess(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deconectarea OpenAI a eșuat.';
    setters.setAiError(message);
  } finally {
    setters.setAiSaving(false);
  }
}

async function loadSelfHostedModelsList(
  api: ReturnType<typeof useApiClient>,
  setSelfHostedModels: (v: string[]) => void,
  cancelled: () => boolean
): Promise<void> {
  try {
    const data = await api.getApi<{
      endpoints: { enabled: boolean; modelId: string; type: 'chat' | 'embedding' | 'both' }[];
    }>('/settings/selfhosted');
    if (cancelled()) return;
    const models = (data.endpoints ?? [])
      .filter(
        (endpoint) =>
          endpoint.enabled &&
          (endpoint.type === 'chat' || endpoint.type === 'embedding' || endpoint.type === 'both')
      )
      .map((endpoint) => endpoint.modelId)
      .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);
    setSelfHostedModels(models);
  } catch {
    if (!cancelled()) setSelfHostedModels([]);
  }
}

const BASE_MODELS: Record<string, { label: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o3',
      'o3-mini',
      'o4-mini',
      'text-embedding-3-small',
      'text-embedding-3-large',
    ],
  },
  xai: {
    label: 'xAI Grok',
    models: ['grok-4-1-fast-non-reasoning', 'grok-4-1-fast', 'grok-4', 'grok-3', 'grok-3-mini'],
  },
  gemini: {
    label: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  },
  deepseek: {
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  selfhosted: {
    label: 'Self-hosted',
    models: [],
  },
};

const TASK_LABELS: Record<string, { label: string; description: string }> = {
  translation: { label: 'Traducere', description: 'Traducerea colecțiilor și textelor (RO→EN)' },
  classification: { label: 'Clasificare', description: 'Asignarea taxonomiei Shopify la colecții' },
  embedding: {
    label: 'Embedding-uri',
    description: 'Generarea vectorilor pentru căutare semantică',
  },
  extraction: { label: 'Extracție', description: 'Extragerea datelor structurate din pagini web' },
  audit: { label: 'Audit AI', description: 'Validarea și auditul calității datelor' },
};

function buildModelOptions(params: {
  task: keyof ModelRoutingResponse;
  selfHostedModels: string[];
}): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const models: Record<string, { label: string; models: string[] }> = {
    ...BASE_MODELS,
    selfhosted: {
      label: 'Self-hosted',
      models: params.selfHostedModels,
    },
  };

  for (const [provider, config] of Object.entries(models)) {
    for (const model of config.models) {
      const isEmbeddingModel = model.includes('embedding');
      if (params.task === 'embedding' && !isEmbeddingModel) continue;
      if (params.task !== 'embedding' && isEmbeddingModel) continue;
      options.push({ value: `${provider}:${model}`, label: `${config.label} — ${model}` });
    }
  }
  return options;
}

function normalizeStatus(value: AiSettingsResponse['connectionStatus']): OpenAiConnectionStatus {
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

function applyStoredKeyHealthState(
  data: AiHealthResponse,
  setters: Pick<
    AiStateSetters,
    'setConnectionStatus' | 'setLastError' | 'setLastSuccessAt' | 'setLastCheckedAt'
  >
): void {
  setters.setLastCheckedAt(new Date().toISOString());
  if (data.status === 'ok') {
    setters.setConnectionStatus('connected');
    setters.setLastError(null);
    setters.setLastSuccessAt(new Date().toISOString());
    return;
  }
  if (data.status === 'disabled') {
    setters.setConnectionStatus('disabled');
    setters.setLastError(null);
    return;
  }
  if (data.status === 'missing_key') {
    setters.setConnectionStatus('missing_key');
    setters.setLastError(null);
    return;
  }
  setters.setConnectionStatus('error');
  setters.setLastError(data.message ?? 'Eroare conexiune');
}

async function executeHealthRequest(
  api: ReturnType<typeof useApiClient>,
  trimmedKey: string,
  aiHasApiKey: boolean
): Promise<AiHealthResponse> {
  if (trimmedKey.length > 0) {
    return api.postApi<AiHealthResponse, { apiKey: string }>('/settings/ai/health', {
      apiKey: trimmedKey,
    });
  }
  if (aiHasApiKey) {
    return api.postApi<AiHealthResponse, { useStoredKey: true }>('/settings/ai/health', {
      useStoredKey: true,
    });
  }
  return api.getApi<AiHealthResponse>('/settings/ai/health');
}

async function runOpenAiHealthTest(
  api: ReturnType<typeof useApiClient>,
  state: { aiApiKeyDirty: boolean; aiApiKey: string; aiHasApiKey: boolean },
  setters: Pick<
    AiStateSetters,
    | 'setAiHealthResult'
    | 'setAiModels'
    | 'setConnectionStatus'
    | 'setLastError'
    | 'setLastSuccessAt'
    | 'setLastCheckedAt'
    | 'setAiHealthLoading'
    | 'setLastTestedKey'
  >
): Promise<void> {
  setters.setAiHealthLoading(true);
  setters.setAiHealthResult(null);
  try {
    const trimmedKey = state.aiApiKeyDirty ? state.aiApiKey.trim() : '';
    const usingStoredKey = trimmedKey.length === 0 && state.aiHasApiKey;
    const data = await executeHealthRequest(api, trimmedKey, state.aiHasApiKey);
    setters.setAiHealthResult(data);
    if (Array.isArray(data.availableModels)) {
      setters.setAiModels(data.availableModels);
    }
    if (usingStoredKey) {
      applyStoredKeyHealthState(data, setters);
    }
    setters.setLastTestedKey(data.status === 'ok' ? trimmedKey || '__stored__' : null);
  } catch (error) {
    setters.setAiHealthResult({
      status: 'error',
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Test conexiune eșuat.',
    });
    setters.setLastTestedKey(null);
  } finally {
    setters.setAiHealthLoading(false);
  }
}

async function saveOpenAiSettings(
  api: ReturnType<typeof useApiClient>,
  state: {
    aiEnabled: boolean;
    aiBaseUrl: string;
    aiEmbeddingsModel: string;
    aiBatchSize: number;
    aiSimilarityThreshold: number;
    aiApiKeyDirty: boolean;
    aiApiKey: string;
    canSave: boolean;
    lastTestedKey: string | null;
  },
  setters: Pick<
    AiStateSetters,
    | 'setAiHasApiKey'
    | 'setAiModels'
    | 'setConnectionStatus'
    | 'setLastCheckedAt'
    | 'setLastSuccessAt'
    | 'setLastError'
    | 'setLastTestedKey'
  > & {
    setAiApiKey: (v: string) => void;
    setAiApiKeyDirty: (v: boolean) => void;
    setAiSuccess: (v: boolean) => void;
    setAiError: (v: string | null) => void;
    setAiSaving: (v: boolean) => void;
  }
): Promise<void> {
  if (!state.canSave) {
    setters.setAiError('Testează conexiunea înainte de a salva setările OpenAI.');
    return;
  }
  setters.setAiSaving(true);
  setters.setAiError(null);
  try {
    const payload: AiSettingsUpdateRequest = {
      enabled: state.aiEnabled,
      openaiBaseUrl: state.aiBaseUrl || null,
      openaiEmbeddingsModel: state.aiEmbeddingsModel || null,
      embeddingBatchSize: state.aiBatchSize,
      similarityThreshold: state.aiSimilarityThreshold,
    };
    if (state.aiApiKeyDirty) {
      payload.apiKey = state.aiApiKey;
    }
    const data = await api.putApi<AiSettingsResponse, AiSettingsUpdateRequest>(
      '/settings/ai',
      payload
    );
    setters.setAiHasApiKey(data.hasApiKey);
    setters.setAiModels(data.availableModels ?? []);
    setters.setConnectionStatus(normalizeStatus(data.connectionStatus));
    setters.setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
    setters.setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
    setters.setLastError(coerceNullableString(data.lastError));
    setters.setAiApiKey('');
    setters.setAiApiKeyDirty(false);
    setters.setAiSuccess(true);
    if (state.lastTestedKey) {
      setters.setLastTestedKey('__stored__');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Salvarea setărilor OpenAI a eșuat.';
    setters.setAiError(message);
  } finally {
    setters.setAiSaving(false);
  }
}

function HealthResultLabel({ result }: { result: AiHealthResponse }): ReactNode {
  if (result.status === 'ok') {
    return `Conexiune OK (${(result.latencyMs ?? 0).toLocaleString('ro-RO')} ms)`;
  }
  if (result.status === 'disabled') return 'OpenAI dezactivat';
  if (result.status === 'missing_key') return 'API key lipsă';
  return result.message ?? 'Eroare conexiune';
}

function ConnectionStatusBar({
  connectionStatus,
  lastCheckedAt,
  lastSuccessAt,
  lastError,
}: Readonly<{
  connectionStatus: OpenAiConnectionStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}>): ReactNode {
  if (!connectionStatus || connectionStatus === 'unknown') return null;
  return (
    <div className="text-xs text-muted">
      Status conexiune: {CONNECTION_STATUS_LABELS[connectionStatus]}
      {lastCheckedAt ? ` · verificat ${new Date(lastCheckedAt).toLocaleString('ro-RO')}` : ''}
      {lastSuccessAt ? ` · succes ${new Date(lastSuccessAt).toLocaleString('ro-RO')}` : ''}
      {lastError ? ` · ${lastError}` : ''}
    </div>
  );
}

function ModelRoutingSection(): ReactNode {
  const api = useApiClient();
  const [routing, setRouting] = useState<ModelRoutingResponse>({
    translation: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
    classification: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
    embedding: 'selfhosted:qwen3-embedding-8b-q5km',
    extraction: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
    audit: 'selfhosted:Qwen/QwQ-32B-AWQ',
  });
  const [routingLoading, setRoutingLoading] = useState(true);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingSuccess, setRoutingSuccess] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [selfHostedModels, setSelfHostedModels] = useState<string[]>([]);

  const routingSubmitState = useMemo(() => {
    if (routingSaving) return 'loading';
    if (routingSuccess) return 'success';
    if (routingError) return 'error';
    return 'idle';
  }, [routingSaving, routingSuccess, routingError]);

  useEffect(() => {
    let cancelled = false;
    const loadRouting = async () => {
      setRoutingLoading(true);
      try {
        const data = await api.getApi<ModelRoutingResponse>('/settings/ai/model-routing');
        if (!cancelled) setRouting(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setRoutingLoading(false);
      }
    };
    void loadRouting();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    void loadSelfHostedModelsList(api, setSelfHostedModels, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!routingSuccess) return;
    const timer = setTimeout(() => setRoutingSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [routingSuccess]);

  const saveRouting = useCallback(
    async (event: { preventDefault: () => void }): Promise<void> => {
      event.preventDefault();
      setRoutingSaving(true);
      setRoutingError(null);
      try {
        const data = await api.putApi<ModelRoutingResponse, Record<string, unknown>>(
          '/settings/ai/model-routing',
          routing as unknown as Record<string, unknown>
        );
        setRouting(data);
        setRoutingSuccess(true);
      } catch (error) {
        setRoutingError(error instanceof Error ? error.message : 'Salvare eșuată');
      } finally {
        setRoutingSaving(false);
      }
    },
    [api, routing]
  );

  const onSaveRoutingSubmit = (event: { preventDefault: () => void }): void => {
    void saveRouting(event);
  };

  const modelOptionsByTask = useMemo(
    () => ({
      translation: buildModelOptions({ task: 'translation', selfHostedModels }),
      classification: buildModelOptions({ task: 'classification', selfHostedModels }),
      embedding: buildModelOptions({ task: 'embedding', selfHostedModels }),
      extraction: buildModelOptions({ task: 'extraction', selfHostedModels }),
      audit: buildModelOptions({ task: 'audit', selfHostedModels }),
    }),
    [selfHostedModels]
  );

  return (
    <div className="mt-8 border-t border-muted/20 pt-6">
      <h3 className="mb-1 text-lg font-semibold text-foreground  inline-flex items-center gap-2">
        Rutare modele per task
        <InfoTooltip title="Rutare modele AI" side="bottom" portalToBody>
          Alege ce model și furnizor AI folosește fiecare operație. Poți optimiza costurile folosind
          modele economice pentru task-uri simple (traducere) și modele premium pentru task-uri
          complexe (clasificare). Fiecare furnizor trebuie să aibă cheia API configurată în tab-ul
          său. Sfat: gpt-4o-mini e ideal pentru traduceri; text-embedding-3-large e cel mai precis
          pentru embedding-uri.
        </InfoTooltip>
      </h3>
      <p className="mb-4 text-sm text-muted">
        Selectează furnizorul și modelul AI pentru fiecare tip de operație.
      </p>

      {routingLoading ? (
        <LoadingState label="Se încarcă configurația modelelor..." />
      ) : (
        <form onSubmit={onSaveRoutingSubmit} className="space-y-4">
          {routingError ? <ErrorState message={routingError} /> : null}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(TASK_LABELS).map(([task, { label, description }]) => (
              <label key={task} className="space-y-1 text-sm">
                <span className="font-medium text-foreground  inline-flex items-center gap-1">
                  {label}
                  <InfoTooltip title={label} side="bottom" portalToBody>
                    {description}
                  </InfoTooltip>
                </span>
                <Select
                  value={routing[task as keyof ModelRoutingResponse] ?? ''}
                  onChange={(e) => setRouting((prev) => ({ ...prev, [task]: e.target.value }))}
                  options={modelOptionsByTask[task as keyof ModelRoutingResponse] ?? []}
                />
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <SubmitButton state={routingSubmitState}>Salvează rutarea modelelor</SubmitButton>
          </div>

          {routingSuccess ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-(--shadow-sm)">
              Rutarea modelelor a fost salvată.
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}

const CONNECTION_STATUS_LABELS: Record<OpenAiConnectionStatus, string> = {
  unknown: 'necunoscut',
  connected: 'conectat',
  error: 'eroare',
  disabled: 'dezactivat',
  missing_key: 'cheie lipsă',
  pending: 'în așteptare',
};

export default function SettingsOpenAi() {
  const api = useApiClient();

  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSuccess, setAiSuccess] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiEmbeddingsModel, setAiEmbeddingsModel] = useState('');
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiBatchSize, setAiBatchSize] = useState(100);
  const [aiSimilarityThreshold, setAiSimilarityThreshold] = useState(0.8);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiApiKeyDirty, setAiApiKeyDirty] = useState(false);
  const [aiHasApiKey, setAiHasApiKey] = useState(false);
  const [todayUsage, setTodayUsage] = useState<AiSettingsResponse['todayUsage']>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<OpenAiConnectionStatus>('unknown');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [aiHealthLoading, setAiHealthLoading] = useState(false);
  const [aiHealthResult, setAiHealthResult] = useState<AiHealthResponse | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const setters: AiStateSetters = {
      setAiEnabled,
      setAiBaseUrl,
      setAiEmbeddingsModel,
      setAiModels,
      setAiBatchSize,
      setAiSimilarityThreshold,
      setAiHasApiKey,
      setTodayUsage,
      setConnectionStatus,
      setLastCheckedAt,
      setLastSuccessAt,
      setLastError,
      setLastTestedKey,
      setAiHealthResult,
      setAiHealthLoading,
      setAiLoading,
      setAiError,
    };
    void loadAndApplyAiSettings(api, setters, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!aiSuccess) return;
    const timer = setTimeout(() => setAiSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [aiSuccess]);

  const aiSubmitState = useMemo(() => {
    if (aiSaving) return 'loading';
    if (aiSuccess) return 'success';
    if (aiError) return 'error';
    return 'idle';
  }, [aiError, aiSaving, aiSuccess]);

  const effectiveKey = useMemo(() => {
    if (aiApiKeyDirty) return aiApiKey.trim();
    if (aiHasApiKey) return '__stored__';
    return '';
  }, [aiApiKeyDirty, aiApiKey, aiHasApiKey]);
  const isConnectionTested = lastTestedKey === effectiveKey;
  const mustTestConnection = aiEnabled || aiApiKeyDirty;
  const canSave = !mustTestConnection || isConnectionTested;
  const isConnected =
    connectionStatus === 'connected' && aiEnabled && aiHasApiKey && !aiApiKeyDirty;

  const onSaveAiSettingsSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    void saveOpenAiSettings(
      api,
      {
        aiEnabled,
        aiBaseUrl,
        aiEmbeddingsModel,
        aiBatchSize,
        aiSimilarityThreshold,
        aiApiKeyDirty,
        aiApiKey,
        canSave,
        lastTestedKey,
      },
      {
        setAiHasApiKey,
        setAiModels,
        setConnectionStatus,
        setLastCheckedAt,
        setLastSuccessAt,
        setLastError,
        setLastTestedKey,
        setAiApiKey,
        setAiApiKeyDirty,
        setAiSuccess,
        setAiError,
        setAiSaving,
      }
    );
  };

  const disconnectConnection = async () => {
    await disconnectOpenAiConnection(api, {
      setAiEnabled,
      setAiHasApiKey,
      setConnectionStatus,
      setLastCheckedAt,
      setLastSuccessAt,
      setLastError,
      setLastTestedKey,
      setAiHealthResult,
      setAiError,
      setAiApiKey,
      setAiApiKeyDirty,
      setAiSaving,
      setAiSuccess,
    });
  };

  const onDisconnectClick = (): void => {
    void disconnectConnection();
  };

  const onTestConnectionClick = (): void => {
    void runOpenAiHealthTest(
      api,
      { aiApiKeyDirty, aiApiKey, aiHasApiKey },
      {
        setAiHealthResult,
        setAiModels,
        setConnectionStatus,
        setLastError,
        setLastSuccessAt,
        setLastCheckedAt,
        setAiHealthLoading,
        setLastTestedKey,
      }
    );
  };

  return (
    <div className="space-y-4">
      {aiLoading ? (
        <LoadingState label="Se încarcă setările OpenAI..." />
      ) : aiError ? (
        <ErrorState message={aiError} />
      ) : (
        <>
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
              </Card>
            </div>
          ) : null}

          <form onSubmit={onSaveAiSettingsSubmit} className="space-y-4">
            <label className="flex items-center gap-2 text-foreground ">
              <Checkbox
                checked={aiEnabled}
                onChange={(event) => {
                  setAiEnabled(event.target.checked);
                  setAiHealthResult(null);
                  setLastTestedKey(null);
                }}
              />
              <span className="inline-flex items-center gap-1">
                Activează OpenAI pentru acest shop
                <InfoTooltip title="Activare OpenAI" side="bottom" portalToBody>
                  Activează sau dezactivează integrarea OpenAI pentru generarea embedding-urilor și
                  căutarea semantică. Fără OpenAI activ, potrivirile de similaritate nu vor
                  funcționa. De exemplu, dezactivarea oprește imediat procesarea embedding-urilor
                  noi. Sfat: dezactivează doar dacă vrei să oprești temporar costurile.
                </InfoTooltip>
              </span>
            </label>

            <div>
              <label
                className="text-caption text-muted inline-flex items-center gap-1"
                htmlFor="openai-api-key"
              >
                Cheie API OpenAI
                <InfoTooltip title="Cheie API OpenAI" side="bottom" portalToBody>
                  Cheia de acces la API-ul OpenAI pentru generarea embedding-urilor și căutarea
                  semantică. Obțineți o cheie din contul OpenAI (platform.openai.com). De exemplu,
                  format: „sk-proj-abc123...". Sfat: cheia e stocată criptat; lăsați câmpul gol dacă
                  e deja salvată.
                </InfoTooltip>
              </label>
              <TextField
                id="openai-api-key"
                type="password"
                value={aiApiKey}
                onChange={(event) => {
                  setAiApiKey(event.target.value);
                  setAiApiKeyDirty(true);
                  setAiHealthResult(null);
                  setLastTestedKey(null);
                }}
                placeholder={aiHasApiKey ? '••••••••' : 'sk-...'}
              />
              <p className="mt-1 text-xs text-muted">Cheia este stocată criptat în baza de date.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted inline-flex items-center gap-1">
                  Model embeddings
                  <InfoTooltip title="Model embeddings" side="bottom" portalToBody>
                    Modelul folosit pentru transformarea textului în vectori numerici (embeddings).
                    text-embedding-3-small oferă un echilibru bun între calitate și cost. De
                    exemplu, „text-embedding-3-large" e mai precis dar de 6× mai scump. Sfat: lista
                    se actualizează automat după testul conexiunii.
                  </InfoTooltip>
                </span>
                <Select
                  value={aiEmbeddingsModel}
                  onChange={(e) => setAiEmbeddingsModel(e.target.value)}
                  options={aiModels.map((model) => ({ value: model, label: model }))}
                />
              </label>
              <div className="space-y-1 text-sm">
                <span className="text-muted inline-flex items-center gap-1">
                  Dimensiune lot
                  <InfoTooltip title="Dimensiune lot (Batch Size)" side="bottom" portalToBody>
                    Câte produse se procesează simultan la generarea embedding-urilor. Loturi mai
                    mari reduc numărul de apeluri API dar cresc consumul de memorie. De exemplu, 200
                    produse/lot face 5 apeluri pentru 1000 produse în loc de 10. Sfat: 100–200
                    pentru cataloage medii; 50 pentru servere mici.
                  </InfoTooltip>
                </span>
                <TextField
                  type="number"
                  min={10}
                  max={500}
                  value={String(aiBatchSize)}
                  onChange={(event) => setAiBatchSize(Number(event.target.value))}
                />
              </div>
            </div>

            <div>
              <label
                className="text-caption text-muted inline-flex items-center gap-1"
                htmlFor="openai-threshold"
              >
                Prag similaritate:{' '}
                {aiSimilarityThreshold.toLocaleString('ro-RO', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <InfoTooltip title="Prag similaritate" side="bottom" portalToBody>
                  Produsele cu scor de similaritate sub acest prag nu sunt considerate potriviri.
                  Valori mari (0,9+) reduc falsurile pozitive dar pot rata potriviri valide. De
                  exemplu, la 0.85, „husă iPhone 15" se potrivește cu „carcasă iPhone 15 Pro". Sfat:
                  0,80–0,85 oferă cel mai bun echilibru.
                </InfoTooltip>
              </label>
              <input
                id="openai-threshold"
                type="range"
                min={0.7}
                max={0.95}
                step={0.01}
                value={aiSimilarityThreshold}
                onChange={(event) => setAiSimilarityThreshold(Number(event.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </div>

            <div>
              <label
                className="text-caption text-muted inline-flex items-center gap-1"
                htmlFor="openai-base-url"
              >
                URL bază OpenAI (opțional)
                <InfoTooltip title="URL bază OpenAI" side="bottom" portalToBody>
                  Adresa serverului API — lăsați gol pentru API-ul oficial OpenAI. Completați doar
                  dacă folosiți un proxy sau un serviciu compatibil (Azure OpenAI, LiteLLM etc.). De
                  exemplu, „https://my-proxy.example.com/v1". Sfat: formatul trebuie să fie URL
                  complet cu protocol.
                </InfoTooltip>
              </label>
              <TextField
                id="openai-base-url"
                type="text"
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <SubmitButton state={aiSubmitState} disabled={!canSave || isConnected}>
                  {isConnected ? 'Conexiune activă' : 'Salvează setări OpenAI'}
                </SubmitButton>
                <InfoTooltip title="Salvare setări" side="bottom" portalToBody>
                  Salvează toate modificările de pe această pagină (model, batch size, prag, URL).
                  Cheia API se trimite doar dacă a fost modificată. De exemplu, poți schimba pragul
                  de similaritate fără a retrimite cheia. Sfat: testează conexiunea înainte de prima
                  salvare.
                </InfoTooltip>
              </span>
              {isConnected ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onDisconnectClick}
                  disabled={aiSaving}
                >
                  Deconectează
                </Button>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onTestConnectionClick}
                  disabled={!aiHasApiKey && !aiApiKeyDirty}
                >
                  {aiHealthLoading ? 'Se testează...' : 'Test conexiune'}
                </Button>
                <InfoTooltip title="Test conexiune OpenAI" side="bottom" portalToBody>
                  Verifică dacă cheia API este validă și API-ul OpenAI răspunde corect. Testul
                  returnează latența și lista modelelor disponibile. De exemplu, un test reușit
                  actualizează automat lista de modele. Sfat: obligatoriu înainte de prima salvare a
                  cheii.
                </InfoTooltip>
              </span>
              {aiHealthResult ? (
                <span
                  className={`text-xs ${aiHealthResult.status === 'ok' ? 'text-success' : 'text-error'}`}
                >
                  <HealthResultLabel result={aiHealthResult} />
                </span>
              ) : null}
            </div>

            {!canSave && !isConnected ? (
              <div className="text-xs text-warning">
                Pentru a salva conexiunea, testează mai întâi conexiunea OpenAI.
              </div>
            ) : null}
            <ConnectionStatusBar
              connectionStatus={connectionStatus}
              lastCheckedAt={lastCheckedAt}
              lastSuccessAt={lastSuccessAt}
              lastError={lastError}
            />

            {aiSuccess ? (
              <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-(--shadow-sm)">
                Setările OpenAI au fost salvate.
              </div>
            ) : null}
          </form>

          <ModelRoutingSection />
        </>
      )}
    </div>
  );
}
