import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { ConnectionStatus } from '../components/domain/connection-status';
import { WebhookTester } from '../components/domain/webhook-tester';
import { InfoTooltip } from '../components/ui/info-tooltip';
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
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Se încarcă statusul conexiunii...
        </div>
      ) : null}

      {apiError ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
          {apiError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={reconnectShop}
            disabled={!shopInfo?.shopDomain}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm transition-shadow duration-200 hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:focus-visible:ring-blue-400/50"
          >
            Reconectare shop
          </button>
          <InfoTooltip title="Reconectare shop" side="bottom" portalToBody>
            Reinițiază fluxul OAuth cu Shopify pentru a obține un token de acces nou. Folosește
            această opțiune dacă tokenul a expirat sau dacă ai schimbat permisiunile aplicației. De
            exemplu, după adăugarea unui scope nou, reconectarea actualizează tokenul. Sfat: vei fi
            redirecționat către Shopify și înapoi automat.
          </InfoTooltip>
        </span>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshWebhooks()}
            disabled={webhookRefreshLoading}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm transition-shadow duration-200 hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:focus-visible:ring-blue-400/50"
          >
            {webhookRefreshLoading ? 'Reînregistrare...' : 'Reînregistrează webhooks'}
          </button>
          <InfoTooltip title="Reînregistrare webhooks" side="bottom" portalToBody>
            Verifică și reînregistrează toate webhook-urile necesare la Shopify. Rezolvă automat
            topic-urile lipsă sau expirate. De exemplu, dacă un webhook pentru „products/update"
            lipsește, va fi recreat. Sfat: folosește după reconectare sau dacă observi că
            notificările nu mai ajung.
          </InfoTooltip>
        </span>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDisconnectOpen(true)}
            disabled={disconnectLoading}
            className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm transition-shadow duration-200 hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700/50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus-visible:ring-blue-400/50"
          >
            {disconnectLoading ? 'Deconectare...' : 'Deconectează shop'}
          </button>
          <InfoTooltip title="Deconectare shop" side="bottom" portalToBody>
            Șterge tokenul de acces și oprește toate sincronizările cu Shopify. Acțiunea este
            reversibilă prin reconectare, dar datele în curs de procesare se vor pierde. De exemplu,
            o sincronizare activă va fi întreruptă imediat. Sfat: folosește doar dacă vrei să
            oprești complet integrarea.
          </InfoTooltip>
        </span>
        {webhookRefreshMessage ? (
          <span className="text-xs text-muted dark:text-slate-400">{webhookRefreshMessage}</span>
        ) : null}
        {disconnectMessage ? (
          <span className="text-xs text-muted dark:text-slate-400">{disconnectMessage}</span>
        ) : null}
      </div>

      {connectionStatus ? (
        <ConnectionStatus
          status={connectionStatus.shopifyApiStatus}
          tokenHealthy={connectionStatus.tokenHealthy}
          checkedAt={connectionStatus.tokenHealthCheckAt}
          scopes={connectionStatus.scopes}
        />
      ) : null}

      <div className="space-y-2 rounded-md border border-muted/20 bg-muted/5 p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground dark:text-slate-100">
            URI webhook aplicație
          </span>
          <InfoTooltip title="URI webhook" side="bottom" portalToBody>
            Adresa unde Shopify trimite notificările pentru evenimente (produse, comenzi etc.).
            Trebuie să fie accesibilă public și să valideze HMAC pentru securitate. De exemplu,
            „https://app.neanelu.com/webhooks/shopify". Sfat: verifică că URL-ul răspunde cu 200 OK
            la un GET simplu.
          </InfoTooltip>
        </div>
        <div className="rounded-md border border-muted/20 bg-background px-3 py-2 text-sm text-muted dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {webhookConfig?.appWebhookUrl ?? '—'}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-muted/20 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-muted/10 text-xs uppercase text-muted dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Topic</th>
              <th className="px-3 py-2 text-left">Adresă</th>
              <th className="px-3 py-2 text-left">Format</th>
              <th className="px-3 py-2 text-left">Versiune API</th>
            </tr>
          </thead>
          <tbody className="dark:text-slate-200">
            {webhookConfig?.webhooks.map((row, index) => (
              <tr
                key={`${row.topic}:${row.address}:${row.apiVersion ?? 'na'}:${index}`}
                className="border-t border-muted/20 dark:border-slate-700"
              >
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
            api.postApi<
              { success: boolean; latencyMs?: number; error?: string },
              { topic: string }
            >('/settings/webhooks/test', { topic })
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
