import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { AiHealthResponse, AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { useApiClient } from '../hooks/use-api';

type OpenAiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

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
    const loadAiSettings = async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const data = await api.getApi<AiSettingsResponse>('/settings/ai');
        if (cancelled) return;
        setAiEnabled(data.enabled);
        setAiBaseUrl(data.openaiBaseUrl ?? '');
        setAiEmbeddingsModel(data.openaiEmbeddingsModel ?? '');
        setAiModels(data.availableModels ?? []);
        setAiBatchSize(data.embeddingBatchSize ?? 100);
        setAiSimilarityThreshold(data.similarityThreshold ?? 0.8);
        setAiHasApiKey(data.hasApiKey);
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
        setAiHealthResult(null);
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Nu am putut încărca setările OpenAI.';
          setAiError(message);
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    void loadAiSettings();
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

  const effectiveKey = aiApiKeyDirty ? aiApiKey.trim() : aiHasApiKey ? '__stored__' : '';
  const isConnectionTested = lastTestedKey === effectiveKey;
  const mustTestConnection = aiEnabled || aiApiKeyDirty;
  const canSave = !mustTestConnection || isConnectionTested;
  const isConnected =
    connectionStatus === 'connected' && aiEnabled && aiHasApiKey && !aiApiKeyDirty;

  const testOpenAiHealth = async () => {
    setAiHealthLoading(true);
    setAiHealthResult(null);
    try {
      const trimmedKey = aiApiKeyDirty ? aiApiKey.trim() : '';
      const usingOverride = trimmedKey.length > 0;
      const usingStoredKey = !usingOverride && aiHasApiKey;
      let data: AiHealthResponse;
      if (trimmedKey) {
        data = await api.postApi<AiHealthResponse, { apiKey: string }>('/settings/ai/health', {
          apiKey: trimmedKey,
        });
      } else if (aiHasApiKey) {
        data = await api.postApi<AiHealthResponse, { useStoredKey: true }>('/settings/ai/health', {
          useStoredKey: true,
        });
      } else {
        data = await api.getApi<AiHealthResponse>('/settings/ai/health');
      }
      setAiHealthResult(data);
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
      setAiHealthResult({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Test conexiune eșuat.',
      });
      setLastTestedKey(null);
    } finally {
      setAiHealthLoading(false);
    }
  };

  const saveAiSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      setAiError('Testează conexiunea înainte de a salva setările OpenAI.');
      return;
    }
    setAiSaving(true);
    setAiError(null);
    try {
      const payload: AiSettingsUpdateRequest = {
        enabled: aiEnabled,
        openaiBaseUrl: aiBaseUrl || null,
        openaiEmbeddingsModel: aiEmbeddingsModel || null,
        embeddingBatchSize: aiBatchSize,
        similarityThreshold: aiSimilarityThreshold,
      };
      if (aiApiKeyDirty) {
        payload.apiKey = aiApiKey;
      }
      const data = await api.getApi<AiSettingsResponse>('/settings/ai', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setAiHasApiKey(data.hasApiKey);
      setConnectionStatus(normalizeStatus(data.connectionStatus));
      setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
      setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
      setLastError(coerceNullableString(data.lastError));
      setAiApiKey('');
      setAiApiKeyDirty(false);
      setAiSuccess(true);
      if (lastTestedKey) {
        setLastTestedKey('__stored__');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea setărilor OpenAI a eșuat.';
      setAiError(message);
    } finally {
      setAiSaving(false);
    }
  };

  const disconnectConnection = async () => {
    setAiSaving(true);
    setAiError(null);
    try {
      const payload: AiSettingsUpdateRequest = {
        enabled: false,
        apiKey: '',
      };
      const data = await api.getApi<AiSettingsResponse>('/settings/ai', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setAiEnabled(false);
      setAiHasApiKey(data.hasApiKey);
      setConnectionStatus(normalizeStatus(data.connectionStatus));
      setLastCheckedAt(coerceNullableString(data.lastCheckedAt));
      setLastSuccessAt(coerceNullableString(data.lastSuccessAt));
      setLastError(coerceNullableString(data.lastError));
      setAiApiKey('');
      setAiApiKeyDirty(false);
      setAiHealthResult(null);
      setLastTestedKey(null);
      setAiSuccess(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deconectarea OpenAI a eșuat.';
      setAiError(message);
    } finally {
      setAiSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {aiLoading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
          Se încarcă setările OpenAI...
        </div>
      ) : null}

      {aiError ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
          {aiError}
        </div>
      ) : null}

      {todayUsage ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-muted/20 p-4">
            <div className="text-sm text-muted">Requests azi</div>
            <div className="mt-1 text-2xl font-semibold">{todayUsage.requests}</div>
          </div>
          <div className="rounded-lg border border-muted/20 p-4">
            <div className="text-sm text-muted">Tokens input</div>
            <div className="mt-1 text-2xl font-semibold">{todayUsage.inputTokens}</div>
          </div>
          <div className="rounded-lg border border-muted/20 p-4">
            <div className="text-sm text-muted">Buget utilizat</div>
            <div className="mt-1 text-2xl font-semibold">
              {(todayUsage.percentUsed * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => void saveAiSettings(event)} className="space-y-4">
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={aiEnabled}
            onChange={(event) => {
              setAiEnabled(event.target.checked);
              setAiHealthResult(null);
              setLastTestedKey(null);
            }}
          />
          Activează OpenAI pentru acest shop
        </label>

        <div>
          <label className="text-caption text-muted" htmlFor="openai-api-key">
            OpenAI API Key
          </label>
          <input
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
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body"
          />
          <p className="mt-1 text-xs text-muted">Cheia este stocată criptat în baza de date.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Model embeddings</span>
            <select
              value={aiEmbeddingsModel}
              onChange={(event) => setAiEmbeddingsModel(event.target.value)}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            >
              {aiModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Batch size</span>
            <input
              type="number"
              min={10}
              max={500}
              value={aiBatchSize}
              onChange={(event) => setAiBatchSize(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="openai-threshold">
            Similarity threshold: {aiSimilarityThreshold.toFixed(2)}
          </label>
          <input
            id="openai-threshold"
            type="range"
            min={0.7}
            max={0.95}
            step={0.01}
            value={aiSimilarityThreshold}
            onChange={(event) => setAiSimilarityThreshold(Number(event.target.value))}
            className="mt-2 w-full"
          />
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="openai-base-url">
            OpenAI Base URL (opțional)
          </label>
          <input
            id="openai-base-url"
            type="text"
            value={aiBaseUrl}
            onChange={(event) => setAiBaseUrl(event.target.value)}
            placeholder="https://api.openai.com"
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={aiSubmitState} disabled={!canSave || isConnected}>
            {isConnected ? 'Conexiune activă' : 'Salvează setări OpenAI'}
          </SubmitButton>
          {isConnected ? (
            <button
              type="button"
              onClick={() => void disconnectConnection()}
              disabled={aiSaving}
              className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm hover:bg-error/5 disabled:opacity-50"
            >
              Deconectează
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void testOpenAiHealth()}
            disabled={!aiHasApiKey && !aiApiKeyDirty}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:opacity-50"
          >
            {aiHealthLoading ? 'Se testează...' : 'Test conexiune'}
          </button>
          {aiHealthResult ? (
            <span
              className={`text-xs ${aiHealthResult.status === 'ok' ? 'text-success' : 'text-error'}`}
            >
              {aiHealthResult.status === 'ok'
                ? `Conexiune OK (${aiHealthResult.latencyMs ?? 0}ms)`
                : aiHealthResult.status === 'disabled'
                  ? 'OpenAI dezactivat'
                  : aiHealthResult.status === 'missing_key'
                    ? 'API key lipsă'
                    : (aiHealthResult.message ?? 'Eroare conexiune')}
            </span>
          ) : null}
        </div>

        {!canSave && !isConnected ? (
          <div className="text-xs text-warning">
            Pentru a salva conexiunea, testează mai întâi conexiunea OpenAI.
          </div>
        ) : null}
        {connectionStatus && connectionStatus !== 'unknown' ? (
          <div className="text-xs text-muted">
            Status conexiune: {connectionStatus}
            {lastCheckedAt ? ` · verificat ${new Date(lastCheckedAt).toLocaleString()}` : ''}
            {lastSuccessAt ? ` · succes ${new Date(lastSuccessAt).toLocaleString()}` : ''}
            {lastError ? ` · ${lastError}` : ''}
          </div>
        ) : null}

        {aiSuccess ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm">
            Setările OpenAI au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
