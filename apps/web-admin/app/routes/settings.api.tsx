import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { ConnectionStatus } from '../components/domain/connection-status';
import { WebhookTester } from '../components/domain/webhook-tester';
import { WarningModal } from '../components/ui/warning-modal';
import { useApiClient } from '../hooks/use-api';
import { useLocalPreferences } from '../hooks/useLocalPreferences';

export default function SettingsApi() {
  const location = useLocation();
  const api = useApiClient();
  const { shopInfo } = useLocalPreferences(api);

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

  useEffect(() => {
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
  }, [api]);

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
        error instanceof Error ? error.message : 'Reîncărcarea webhook-urilor a eșuat.';
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
      setDisconnectMessage('Shop-ul a fost deconectat.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deconectarea a eșuat.';
      setDisconnectMessage(message);
    } finally {
      setDisconnectLoading(false);
      setDisconnectOpen(false);
    }
  };

  return (
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
        {disconnectMessage ? <span className="text-xs text-muted">{disconnectMessage}</span> : null}
      </div>

      {connectionStatus ? (
        <ConnectionStatus
          status={connectionStatus.shopifyApiStatus}
          tokenHealthy={connectionStatus.tokenHealthy}
          checkedAt={connectionStatus.tokenHealthCheckAt}
          scopes={connectionStatus.scopes}
        />
      ) : null}

      <div className="space-y-2 rounded-md border border-muted/20 bg-muted/5 p-4">
        <div className="text-sm font-medium text-foreground">Webhook URI</div>
        <div className="rounded-md border border-muted/20 bg-background px-3 py-2 text-sm text-muted">
          {webhookConfig?.appWebhookUrl ?? '—'}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-muted/20">
        <table className="w-full text-sm">
          <thead className="bg-muted/10 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Topic</th>
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Format</th>
              <th className="px-3 py-2 text-left">API Version</th>
            </tr>
          </thead>
          <tbody>
            {webhookConfig?.webhooks.map((row, index) => (
              <tr key={`${row.topic}:${row.address}:${row.apiVersion ?? 'na'}:${index}`}>
                <td className="px-3 py-2">{row.topic}</td>
                <td className="px-3 py-2">{row.address}</td>
                <td className="px-3 py-2">{row.format}</td>
                <td className="px-3 py-2">{row.apiVersion ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {webhookConfig ? (
        <WebhookTester
          topics={webhookConfig.requiredTopics}
          onTest={(topic) =>
            api.getApi<{ success: boolean; latencyMs?: number; error?: string }>(
              `/settings/webhooks/test?topic=${encodeURIComponent(topic)}`
            )
          }
          disabled={webhookRefreshLoading}
        />
      ) : null}

      <WarningModal
        open={disconnectOpen}
        title="Deconectezi shop-ul?"
        description="Această acțiune va opri sincronizările până la reconectare."
        onConfirm={() => void disconnectShop()}
        onCancel={() => setDisconnectOpen(false)}
      />
    </div>
  );
}
