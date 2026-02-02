import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { AiHealthResponse, AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { useApiClient } from '../hooks/use-api';

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
  const [aiHealthLoading, setAiHealthLoading] = useState(false);
  const [aiHealthResult, setAiHealthResult] = useState<AiHealthResponse | null>(null);
  const [aiHealthError, setAiHealthError] = useState<string | null>(null);

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

  const testOpenAiHealth = async () => {
    setAiHealthLoading(true);
    setAiHealthError(null);
    try {
      const data = await api.getApi<AiHealthResponse>('/settings/ai/health');
      setAiHealthResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Testul conexiunii OpenAI a eșuat.';
      setAiHealthError(message);
    } finally {
      setAiHealthLoading(false);
    }
  };

  const saveAiSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      setAiApiKey('');
      setAiApiKeyDirty(false);
      setAiSuccess(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea setărilor OpenAI a eșuat.';
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

      <form
        onSubmit={(event) => {
          void saveAiSettings(event);
        }}
        className="space-y-4"
      >
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={aiEnabled}
            onChange={(event) => setAiEnabled(event.target.checked)}
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
            }}
            placeholder={aiHasApiKey ? '••••••••' : 'sk-...'}
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body"
          />
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
          <SubmitButton state={aiSubmitState}>Save OpenAI Settings</SubmitButton>
          <button
            type="button"
            onClick={() => void testOpenAiHealth()}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10"
          >
            {aiHealthLoading ? 'Se testează...' : 'Test conexiune'}
          </button>
          {aiHealthError ? <span className="text-xs text-error">{aiHealthError}</span> : null}
          {aiHealthResult ? (
            <span className="text-xs text-muted">
              {aiHealthResult.status === 'ok'
                ? 'OpenAI este activ'
                : aiHealthResult.status === 'disabled'
                  ? 'OpenAI este dezactivat'
                  : aiHealthResult.status === 'missing_key'
                    ? 'Cheie OpenAI lipsă'
                    : 'Conexiune OpenAI indisponibilă'}
            </span>
          ) : null}
        </div>

        {aiSuccess ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm">
            Setările OpenAI au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
