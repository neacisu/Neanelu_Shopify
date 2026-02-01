import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';

import type { AiHealthResponse, AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { ConnectionStatus } from '../components/domain/connection-status';
import { WebhookTester } from '../components/domain/webhook-tester';
import { WarningModal } from '../components/ui/warning-modal';
import { SubmitButton } from '../components/forms/submit-button';
import { Tabs } from '../components/ui/tabs';
import { useApiClient } from '../hooks/use-api';
import { useLocalPreferences } from '../hooks/useLocalPreferences';

export default function SettingsPage() {
  const location = useLocation();
  const api = useApiClient();

  const [activeTab, setActiveTab] = useState('general');

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

  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    shopifyApiStatus: 'connected' | 'degraded' | 'disconnected';
    tokenHealthy: boolean;
    tokenHealthCheckAt: string | null;
    lastApiCallAt: string | null;
    rateLimitRemaining: number | null;
    scopes: string[];
  } | null>(null);
  const [webhookConfig, setWebhookConfig] = useState<{
    webhooks: {
      topic: string;
      address: string;
      format: string;
      apiVersion: string | null;
      registeredAt: string;
    }[];
    appWebhookUrl: string;
    requiredTopics: string[];
    missingTopics: string[];
  } | null>(null);
  const [webhookRefreshLoading, setWebhookRefreshLoading] = useState(false);
  const [webhookRefreshMessage, setWebhookRefreshMessage] = useState<string | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queuesError, setQueuesError] = useState<string | null>(null);
  const [queuesData, setQueuesData] = useState<{
    queues: {
      name: string;
      concurrency: number;
      maxAttempts: number;
      backoffType: 'exponential' | 'fixed';
      backoffDelayMs: number;
      dlqRetentionDays: number;
    }[];
    isAdmin: boolean;
  } | null>(null);
  const [queueEdits, setQueueEdits] = useState<
    Record<
      string,
      {
        name: string;
        concurrency: number;
        maxAttempts: number;
        backoffType: 'exponential' | 'fixed';
        backoffDelayMs: number;
        dlqRetentionDays: number;
      }
    >
  >({});
  const [queueSaving, setQueueSaving] = useState<string | null>(null);
  const [queueSaveMessage, setQueueSaveMessage] = useState<Record<string, string>>({});
  const [warningQueue, setWarningQueue] = useState<string | null>(null);

  const {
    shopInfo,
    preferences,
    updatePreferences,
    loading: generalLoading,
    saving: generalSaving,
    error: generalError,
    saveError: generalSaveError,
    lastSavedAt,
  } = useLocalPreferences(api);

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
    if (activeTab !== 'api') return;
    let cancelled = false;

    const loadApiSettings = async () => {
      setApiLoading(true);
      setApiError(null);
      try {
        const [status, webhooks] = await Promise.all([
          api.getApi<{
            shopifyApiStatus: 'connected' | 'degraded' | 'disconnected';
            tokenHealthy: boolean;
            tokenHealthCheckAt: string | null;
            lastApiCallAt: string | null;
            rateLimitRemaining: number | null;
            scopes: string[];
          }>('/settings/connection'),
          api.getApi<{
            webhooks: {
              topic: string;
              address: string;
              format: string;
              apiVersion: string | null;
              registeredAt: string;
            }[];
            appWebhookUrl: string;
            requiredTopics: string[];
            missingTopics: string[];
          }>('/settings/webhooks'),
        ]);

        if (cancelled) return;
        setConnectionStatus(status);
        setWebhookConfig(webhooks);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Nu am putut încărca statusul.';
          setApiError(message);
        }
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    };

    void loadApiSettings();
    return () => {
      cancelled = true;
    };
  }, [activeTab, api]);

  useEffect(() => {
    if (activeTab !== 'queues') return;
    let cancelled = false;

    const loadQueues = async () => {
      setQueuesLoading(true);
      setQueuesError(null);
      try {
        const data = await api.getApi<{
          queues: {
            name: string;
            concurrency: number;
            maxAttempts: number;
            backoffType: 'exponential' | 'fixed';
            backoffDelayMs: number;
            dlqRetentionDays: number;
          }[];
          isAdmin: boolean;
        }>('/settings/queues');
        if (cancelled) return;
        setQueuesData(data);
        const next: typeof queueEdits = {};
        for (const queue of data.queues) {
          next[queue.name] = { ...queue };
        }
        setQueueEdits(next);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Nu am putut încărca setările.';
          setQueuesError(message);
        }
      } finally {
        if (!cancelled) setQueuesLoading(false);
      }
    };

    void loadQueues();
    return () => {
      cancelled = true;
    };
  }, [activeTab, api]);

  useEffect(() => {
    if (!aiSuccess) return;
    const timer = setTimeout(() => setAiSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [aiSuccess]);

  const timezones = useMemo(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
    return ['Europe/Bucharest', 'Europe/London', 'Europe/Paris', 'America/New_York', 'UTC'];
  }, []);

  const generalStatus = useMemo(() => {
    if (generalSaving) return { tone: 'info', label: 'Se salvează preferințele...' };
    if (generalSaveError) return { tone: 'error', label: generalSaveError };
    if (lastSavedAt) return { tone: 'success', label: 'Preferințele au fost salvate.' };
    return null;
  }, [generalSaveError, generalSaving, lastSavedAt]);

  const reconnectShop = () => {
    if (!shopInfo?.shopDomain || typeof window === 'undefined') return;
    const returnTo = location.pathname;
    const params = new URLSearchParams({ shop: shopInfo.shopDomain, returnTo });
    window.location.href = `/auth?${params.toString()}`;
  };

  const refreshWebhooks = async () => {
    setWebhookRefreshLoading(true);
    setWebhookRefreshMessage(null);
    try {
      const data = await api.getApi<{
        webhooks: {
          topic: string;
          address: string;
          format: string;
          apiVersion: string | null;
          registeredAt: string;
        }[];
        appWebhookUrl: string;
        requiredTopics: string[];
        missingTopics: string[];
      }>('/settings/webhooks/reconcile', { method: 'POST' });
      setWebhookConfig(data);
      setWebhookRefreshMessage('Webhook-urile au fost reînregistrate.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Reînregistrarea webhook-urilor a eșuat.';
      setWebhookRefreshMessage(message);
    } finally {
      setWebhookRefreshLoading(false);
    }
  };

  const disconnectShop = async () => {
    setDisconnectLoading(true);
    setDisconnectMessage(null);
    try {
      await api.getApi('/settings/connection/disconnect', { method: 'POST' });
      setDisconnectMessage('Shopul a fost deconectat.');
      setConnectionStatus((prev) =>
        prev
          ? {
              ...prev,
              shopifyApiStatus: 'disconnected',
              tokenHealthy: false,
              tokenHealthCheckAt: new Date().toISOString(),
            }
          : {
              shopifyApiStatus: 'disconnected',
              tokenHealthy: false,
              tokenHealthCheckAt: new Date().toISOString(),
              lastApiCallAt: null,
              rateLimitRemaining: null,
              scopes: [],
            }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deconectarea a eșuat.';
      setDisconnectMessage(message);
    } finally {
      setDisconnectLoading(false);
    }
  };

  const updateQueueField = (
    name: string,
    field: 'concurrency' | 'maxAttempts' | 'backoffDelayMs' | 'dlqRetentionDays',
    value: number
  ) => {
    setQueueEdits((prev) => {
      const base = prev[name] ?? queuesData?.queues.find((queue) => queue.name === name);
      if (!base) return prev;
      return {
        ...prev,
        [name]: {
          ...base,
          [field]: value,
        },
      };
    });
  };

  const updateQueueBackoffType = (name: string, value: 'exponential' | 'fixed') => {
    setQueueEdits((prev) => {
      const base = prev[name] ?? queuesData?.queues.find((queue) => queue.name === name);
      if (!base) return prev;
      return {
        ...prev,
        [name]: {
          ...base,
          backoffType: value,
        },
      };
    });
  };

  const saveQueueConfig = async (name: string) => {
    const current = queueEdits[name];
    if (!current) return;
    setQueueSaving(name);
    setQueueSaveMessage((prev) => ({ ...prev, [name]: '' }));
    try {
      await api.getApi('/settings/queues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueName: name,
          concurrency: current.concurrency,
          maxAttempts: current.maxAttempts,
          backoffType: current.backoffType,
          backoffDelayMs: current.backoffDelayMs,
          dlqRetentionDays: current.dlqRetentionDays,
        }),
      });
      setQueueSaveMessage((prev) => ({ ...prev, [name]: 'Applied!' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed.';
      setQueueSaveMessage((prev) => ({ ...prev, [name]: message }));
    } finally {
      setQueueSaving(null);
    }
  };

  const requestSaveQueue = (name: string) => {
    const current = queueEdits[name];
    if (!current) return;
    if (current.concurrency > 20) {
      setWarningQueue(name);
      return;
    }
    void saveQueueConfig(name);
  };

  const aiSubmitState = useMemo(() => {
    if (aiSaving) return 'loading';
    if (aiSuccess) return 'success';
    if (aiError) return 'error';
    return 'idle';
  }, [aiError, aiSaving, aiSuccess]);

  const testAiConnection = async () => {
    setAiHealthLoading(true);
    setAiHealthError(null);
    try {
      const data = await api.getApi<AiHealthResponse>('/settings/ai/health');
      setAiHealthResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Testul conexiunii OpenAI a eșuat.';
      setAiHealthError(message);
      setAiHealthResult(null);
    } finally {
      setAiHealthLoading(false);
    }
  };

  const onSaveAiSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAiSaving(true);
    setAiSuccess(false);
    setAiError(null);

    const payload: AiSettingsUpdateRequest = {
      enabled: aiEnabled,
      openaiBaseUrl: aiBaseUrl.trim() ? aiBaseUrl.trim() : null,
      openaiEmbeddingsModel: aiEmbeddingsModel.trim() ? aiEmbeddingsModel.trim() : null,
      embeddingBatchSize: aiBatchSize,
      similarityThreshold: aiSimilarityThreshold,
    };

    if (aiApiKeyDirty) {
      payload.apiKey = aiApiKey;
    }

    try {
      const data = await api.getApi<AiSettingsResponse>('/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setAiEnabled(data.enabled);
      setAiBaseUrl(data.openaiBaseUrl ?? '');
      setAiEmbeddingsModel(data.openaiEmbeddingsModel ?? '');
      setAiModels(data.availableModels ?? aiModels);
      setAiBatchSize(data.embeddingBatchSize ?? aiBatchSize);
      setAiSimilarityThreshold(data.similarityThreshold ?? aiSimilarityThreshold);
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

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Settings', href: location.pathname },
    ],
    [location.pathname]
  );

  const tabs = useMemo(
    () => [
      { label: 'General', value: 'general' },
      { label: 'API & Webhooks', value: 'api' },
      { label: 'Queues', value: 'queues' },
      { label: 'OpenAI', value: 'openai' },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <PageHeader title="Settings" description="Demo form for PR-018 validation patterns." />

      <Tabs items={tabs} value={activeTab} onValueChange={setActiveTab} />

      {activeTab === 'general' ? (
        <div className="space-y-4">
          {generalLoading ? (
            <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
              Se încarcă preferințele...
            </div>
          ) : null}

          {generalError ? (
            <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
              {generalError}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-caption text-muted" htmlFor="shop-name">
                Shop name
              </label>
              <input
                id="shop-name"
                type="text"
                value={shopInfo?.shopName ?? ''}
                placeholder="—"
                disabled
                className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
              />
            </div>

            <div>
              <label className="text-caption text-muted" htmlFor="shop-domain">
                Shop domain
              </label>
              <input
                id="shop-domain"
                type="text"
                value={shopInfo?.shopDomain ?? ''}
                placeholder="store.myshopify.com"
                disabled
                className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
              />
            </div>

            <div>
              <label className="text-caption text-muted" htmlFor="shop-email">
                Shop email
              </label>
              <input
                id="shop-email"
                type="email"
                value={shopInfo?.shopEmail ?? ''}
                placeholder="—"
                disabled
                className="mt-1 w-full rounded-md border border-muted/20 bg-muted/10 px-3 py-2 text-body shadow-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-caption text-muted" htmlFor="timezone">
              Timezone
            </label>
            <select
              id="timezone"
              value={preferences.timezone}
              onChange={(event) => updatePreferences({ timezone: event.target.value })}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-caption text-muted">Language</div>
            <div className="mt-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-body">
                <input
                  type="radio"
                  name="language"
                  value="ro"
                  checked={preferences.language === 'ro'}
                  onChange={() => updatePreferences({ language: 'ro' })}
                />
                Română
              </label>
              <label className="flex items-center gap-2 text-body">
                <input
                  type="radio"
                  name="language"
                  value="en"
                  checked={preferences.language === 'en'}
                  onChange={() => updatePreferences({ language: 'en' })}
                />
                English
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={preferences.notificationsEnabled ?? false}
              onChange={(event) =>
                updatePreferences({ notificationsEnabled: event.target.checked })
              }
            />
            Primește notificări despre sincronizări și alerte
          </label>

          {generalStatus ? (
            <div
              className={`rounded-md border p-3 text-sm shadow-sm ${
                generalStatus.tone === 'error'
                  ? 'border-error/30 bg-error/10 text-error'
                  : generalStatus.tone === 'success'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-muted/20 bg-muted/5 text-muted'
              }`}
            >
              {generalStatus.label}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'api' ? (
        <div className="space-y-4">
          {apiLoading ? (
            <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
              Se încarcă statusul conexiunii...
            </div>
          ) : null}

          {apiError ? (
            <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
              {apiError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={reconnectShop}
              disabled={!shopInfo?.shopDomain}
              className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reconectare shop
            </button>
            <button
              type="button"
              onClick={() => void refreshWebhooks()}
              disabled={webhookRefreshLoading}
              className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {webhookRefreshLoading ? 'Reînregistrare...' : 'Reînregistrează webhooks'}
            </button>
            <button
              type="button"
              onClick={() => setDisconnectOpen(true)}
              disabled={disconnectLoading}
              className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disconnectLoading ? 'Deconectare...' : 'Deconectează shop'}
            </button>
            {webhookRefreshMessage ? (
              <span className="text-xs text-muted">{webhookRefreshMessage}</span>
            ) : null}
            {disconnectMessage ? (
              <span className="text-xs text-muted">{disconnectMessage}</span>
            ) : null}
          </div>

          {connectionStatus ? (
            <ConnectionStatus
              status={connectionStatus.shopifyApiStatus}
              tokenHealthy={connectionStatus.tokenHealthy}
              checkedAt={connectionStatus.tokenHealthCheckAt}
              scopes={connectionStatus.scopes}
              rateLimitRemaining={connectionStatus.rateLimitRemaining}
            />
          ) : null}

          {webhookConfig ? (
            <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
              <div className="text-sm font-medium">Webhook URLs configurate</div>
              {webhookConfig.missingTopics.length ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  Lipsesc {webhookConfig.missingTopics.length} topicuri:{' '}
                  {webhookConfig.missingTopics.join(', ')}
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="border-b border-muted/20 px-2 py-2">Topic</th>
                      <th className="border-b border-muted/20 px-2 py-2">Address</th>
                      <th className="border-b border-muted/20 px-2 py-2">Format</th>
                      <th className="border-b border-muted/20 px-2 py-2">API</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookConfig.webhooks.map((row, index) => (
                      <tr key={`${row.topic}:${row.address}:${row.apiVersion ?? 'na'}:${index}`}>
                        <td className="border-b border-muted/10 px-2 py-2">{row.topic}</td>
                        <td className="border-b border-muted/10 px-2 py-2">{row.address}</td>
                        <td className="border-b border-muted/10 px-2 py-2">{row.format}</td>
                        <td className="border-b border-muted/10 px-2 py-2">
                          {row.apiVersion ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <WebhookTester
            topics={webhookConfig?.requiredTopics ?? []}
            onTest={async (topic) =>
              api.getApi<{ success: boolean; latencyMs?: number; error?: string }>(
                '/settings/webhooks/test',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ topic }),
                }
              )
            }
            disabled={!webhookConfig}
          />
        </div>
      ) : null}

      {activeTab === 'queues' ? (
        <div className="space-y-4">
          {queuesLoading ? (
            <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
              Se încarcă setările de queue...
            </div>
          ) : null}

          {queuesError ? (
            <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
              {queuesError}
            </div>
          ) : null}

          {!queuesLoading && queuesData?.queues.length === 0 ? (
            <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
              Nu există queue-uri configurate.
            </div>
          ) : null}

          {queuesData?.queues.map((queue) => {
            const draft = queueEdits[queue.name] ?? queue;
            const disabled = queuesData.isAdmin === false;
            const message = queueSaveMessage[queue.name];
            return (
              <details key={queue.name} className="rounded-md border border-muted/20 bg-background">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {queue.name}
                </summary>
                <div className="space-y-4 px-4 pb-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label
                        className="text-caption text-muted"
                        htmlFor={`${queue.name}-concurrency`}
                      >
                        Concurrency
                      </label>
                      <input
                        id={`${queue.name}-concurrency`}
                        type="number"
                        min={1}
                        max={50}
                        value={draft.concurrency}
                        disabled={disabled}
                        onChange={(event) =>
                          updateQueueField(queue.name, 'concurrency', Number(event.target.value))
                        }
                        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>

                    <div>
                      <label className="text-caption text-muted" htmlFor={`${queue.name}-attempts`}>
                        Max attempts
                      </label>
                      <input
                        id={`${queue.name}-attempts`}
                        type="number"
                        min={1}
                        max={10}
                        value={draft.maxAttempts}
                        disabled={disabled}
                        onChange={(event) =>
                          updateQueueField(queue.name, 'maxAttempts', Number(event.target.value))
                        }
                        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>

                    <div>
                      <label className="text-caption text-muted" htmlFor={`${queue.name}-dlq`}>
                        DLQ retention (days)
                      </label>
                      <input
                        id={`${queue.name}-dlq`}
                        type="number"
                        min={7}
                        max={90}
                        value={draft.dlqRetentionDays}
                        disabled={disabled}
                        onChange={(event) =>
                          updateQueueField(
                            queue.name,
                            'dlqRetentionDays',
                            Number(event.target.value)
                          )
                        }
                        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>

                    <div>
                      <label className="text-caption text-muted" htmlFor={`${queue.name}-backoff`}>
                        Backoff type
                      </label>
                      <select
                        id={`${queue.name}-backoff`}
                        value={draft.backoffType}
                        disabled={disabled}
                        onChange={(event) =>
                          updateQueueBackoffType(
                            queue.name,
                            event.target.value === 'fixed' ? 'fixed' : 'exponential'
                          )
                        }
                        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <option value="exponential">Exponential</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </div>

                    <div>
                      <label
                        className="text-caption text-muted"
                        htmlFor={`${queue.name}-backoff-delay`}
                      >
                        Backoff delay (ms)
                      </label>
                      <input
                        id={`${queue.name}-backoff-delay`}
                        type="number"
                        min={0}
                        value={draft.backoffDelayMs}
                        disabled={disabled}
                        onChange={(event) =>
                          updateQueueField(queue.name, 'backoffDelayMs', Number(event.target.value))
                        }
                        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  </div>

                  <div className="text-xs text-muted">
                    Modificările pentru max attempts și DLQ retention se aplică după restartul
                    worker-ului.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={disabled || queueSaving === queue.name}
                      onClick={() => requestSaveQueue(queue.name)}
                      className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {queueSaving === queue.name ? 'Saving...' : 'Apply'}
                    </button>
                    {disabled ? (
                      <span className="text-xs text-muted">Admin access required.</span>
                    ) : null}
                    {message ? (
                      <span
                        className={`text-xs ${
                          message === 'Applied!' ? 'text-success' : 'text-error'
                        }`}
                      >
                        {message}
                      </span>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      ) : null}

      {activeTab === 'openai' ? (
        <form onSubmit={(event) => void onSaveAiSettings(event)} className="space-y-4" noValidate>
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
              autoComplete="new-password"
              value={aiApiKey}
              placeholder={aiHasApiKey ? '••••••••••••' : 'Introdu cheia API'}
              onChange={(event) => {
                setAiApiKey(event.target.value);
                setAiApiKeyDirty(true);
              }}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-1 text-caption text-muted">
              Cheia este stocată criptat și nu poate fi afișată după salvare.
            </div>
            {aiHasApiKey ? (
              <button
                type="button"
                className="mt-2 text-caption text-primary hover:underline"
                onClick={() => {
                  setAiApiKey('');
                  setAiApiKeyDirty(true);
                }}
              >
                Șterge cheia salvată
              </button>
            ) : null}
            {aiApiKeyDirty && aiApiKey.trim().length === 0 && aiHasApiKey ? (
              <div className="mt-2 text-caption text-warning">
                Cheia va fi eliminată la salvare.
              </div>
            ) : null}
          </div>

          <div>
            <label className="text-caption text-muted" htmlFor="openai-embeddings-model">
              Model embeddings
            </label>
            <select
              id="openai-embeddings-model"
              value={aiEmbeddingsModel}
              onChange={(event) => setAiEmbeddingsModel(event.target.value)}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {(aiModels.length ? aiModels : ['text-embedding-3-small']).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-caption text-muted" htmlFor="embedding-batch-size">
                Embedding batch size
              </label>
              <input
                id="embedding-batch-size"
                type="number"
                min={10}
                max={500}
                value={aiBatchSize}
                onChange={(event) => setAiBatchSize(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="text-caption text-muted" htmlFor="similarity-threshold">
                Similarity threshold ({aiSimilarityThreshold.toFixed(2)})
              </label>
              <input
                id="similarity-threshold"
                type="range"
                min={0.7}
                max={0.95}
                step={0.01}
                value={aiSimilarityThreshold}
                onChange={(event) => setAiSimilarityThreshold(Number(event.target.value))}
                className="mt-2 w-full"
              />
            </div>
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
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="https://api.openai.com"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void testAiConnection()}
              disabled={aiHealthLoading}
              className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiHealthLoading ? 'Testing...' : 'Test conexiune'}
            </button>
            {aiHealthResult ? (
              <span
                className={`text-xs ${
                  aiHealthResult.status === 'ok'
                    ? 'text-success'
                    : aiHealthResult.status === 'disabled' ||
                        aiHealthResult.status === 'missing_key'
                      ? 'text-warning'
                      : 'text-error'
                }`}
              >
                {aiHealthResult.status === 'ok'
                  ? 'Conexiune OK'
                  : aiHealthResult.status === 'disabled'
                    ? 'OpenAI este dezactivat'
                    : aiHealthResult.status === 'missing_key'
                      ? 'Cheie OpenAI lipsă'
                      : 'Conexiune eșuată'}
              </span>
            ) : null}
            {aiHealthError ? <span className="text-xs text-error">{aiHealthError}</span> : null}
          </div>

          {aiHealthResult?.message ? (
            <div className="text-xs text-muted">{aiHealthResult.message}</div>
          ) : null}

          <SubmitButton state={aiSubmitState}>Save OpenAI Settings</SubmitButton>

          {aiSuccess ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-success shadow-sm">
              Setările OpenAI au fost salvate.
            </div>
          ) : null}
        </form>
      ) : null}

      <WarningModal
        open={warningQueue !== null}
        title="Concurrency ridicată"
        description="Valori peste 20 pot impacta performanța și rate limit-urile. Confirmi schimbarea?"
        onCancel={() => setWarningQueue(null)}
        onConfirm={() => {
          if (warningQueue) {
            void saveQueueConfig(warningQueue);
          }
          setWarningQueue(null);
        }}
      />

      <WarningModal
        open={disconnectOpen}
        title="Deconectare shop"
        description="Această acțiune revocă tokenul și oprește accesul aplicației. Confirmi deconectarea?"
        onCancel={() => setDisconnectOpen(false)}
        onConfirm={() => {
          void disconnectShop();
          setDisconnectOpen(false);
        }}
      />
    </div>
  );
}
