import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { XaiHealthResponse, XaiSettingsResponse, XaiSettingsUpdateRequest } from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { useApiClient } from '../hooks/use-api';

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
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<XaiHealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

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

  const testHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await api.getApi<XaiHealthResponse>('/settings/xai/health');
      setHealthResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Testul conexiunii xAI a eșuat.';
      setHealthError(message);
    } finally {
      setHealthLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      const data = await api.getApi<XaiSettingsResponse>('/settings/xai', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setHasApiKey(data.hasApiKey);
      setApiKey('');
      setApiKeyDirty(false);
      setSuccess(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea setărilor xAI a eșuat.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
          Se încarcă setările xAI Grok...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          void saveSettings(event);
        }}
        className="space-y-4"
      >
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Activează xAI Grok pentru AI Auditor
        </label>

        <div>
          <label className="text-caption text-muted" htmlFor="xai-api-key">
            xAI API Key
          </label>
          <input
            id="xai-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyDirty(true);
            }}
            placeholder={hasApiKey ? '••••••••' : 'xai-...'}
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Model</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            >
              {availableModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Max tokens per request</span>
            <input
              type="number"
              min={256}
              max={8000}
              value={maxTokens}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="xai-temperature">
            Temperature: {temperature.toFixed(2)}
          </label>
          <input
            id="xai-temperature"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            className="mt-2 w-full"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Rate limit (req/min)</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={rateLimit}
              onChange={(event) => setRateLimit(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Daily budget</span>
            <input
              type="number"
              min={0}
              max={100000}
              value={dailyBudget}
              onChange={(event) => setDailyBudget(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Alert threshold</span>
            <input
              type="number"
              min={0.5}
              max={0.99}
              step={0.01}
              value={budgetAlertThreshold}
              onChange={(event) => setBudgetAlertThreshold(Number(event.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="xai-base-url">
            xAI Base URL (opțional)
          </label>
          <input
            id="xai-base-url"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.x.ai/v1"
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState}>Save xAI Settings</SubmitButton>
          <button
            type="button"
            onClick={() => void testHealth()}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10"
          >
            {healthLoading ? 'Se testează...' : 'Test conexiune'}
          </button>
          {healthError ? <span className="text-xs text-error">{healthError}</span> : null}
          {healthResult ? (
            <span className="text-xs text-muted">
              {healthResult.status === 'connected'
                ? 'xAI este activ'
                : healthResult.status === 'disabled'
                  ? 'xAI este dezactivat'
                  : healthResult.status === 'missing_key'
                    ? 'Cheie xAI lipsă'
                    : 'Conexiune xAI indisponibilă'}
            </span>
          ) : null}
        </div>

        {success ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success shadow-sm">
            Setările xAI au fost salvate.
          </div>
        ) : null}
      </form>
    </div>
  );
}
