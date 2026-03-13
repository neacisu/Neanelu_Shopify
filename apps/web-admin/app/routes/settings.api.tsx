import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { ConnectionStatus } from '../components/domain/connection-status';
import { WebhookTester } from '../components/domain/webhook-tester';
import { ErrorState } from '../components/patterns/error-state.js';
import { LoadingState } from '../components/patterns/loading-state.js';
import { Button } from '../components/ui/button';
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
        <LoadingState label="Se încarcă statusul conexiunii..." />
      ) : apiError ? (
        <ErrorState message={apiError} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                onClick={reconnectShop}
                disabled={!shopInfo?.shopDomain}
              >
                Reconectare shop
              </Button>
              <InfoTooltip title="Reconectare shop" side="bottom" portalToBody>
                Reinițiază fluxul OAuth cu Shopify pentru a obține un token de acces nou. Folosește
                această opțiune dacă tokenul a expirat sau dacă ai schimbat permisiunile aplicației.
                De exemplu, după adăugarea unui scope nou, reconectarea actualizează tokenul. Sfat:
                vei fi redirecționat către Shopify și înapoi automat.
              </InfoTooltip>
            </span>
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void refreshWebhooks()}
                disabled={webhookRefreshLoading}
                loading={webhookRefreshLoading}
              >
                {webhookRefreshLoading ? 'Reînregistrare...' : 'Reînregistrează webhooks'}
              </Button>
              <InfoTooltip title="Reînregistrare webhooks" side="bottom" portalToBody>
                Verifică și reînregistrează toate webhook-urile necesare la Shopify. Rezolvă automat
                topic-urile lipsă sau expirate. De exemplu, dacă un webhook pentru „products/update"
                lipsește, va fi recreat. Sfat: folosește după reconectare sau dacă observi că
                notificările nu mai ajung.
              </InfoTooltip>
            </span>
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDisconnectOpen(true)}
                disabled={disconnectLoading}
                loading={disconnectLoading}
              >
                {disconnectLoading ? 'Deconectare...' : 'Deconectează shop'}
              </Button>
              <InfoTooltip title="Deconectare shop" side="bottom" portalToBody>
                Șterge tokenul de acces și oprește toate sincronizările cu Shopify. Acțiunea este
                reversibilă prin reconectare, dar datele în curs de procesare se vor pierde. De
                exemplu, o sincronizare activă va fi întreruptă imediat. Sfat: folosește doar dacă
                vrei să oprești complet integrarea.
              </InfoTooltip>
            </span>
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
            />
          ) : null}

          <div className="space-y-2 rounded-md border border-border bg-muted/5 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">URI webhook aplicație</span>
              <InfoTooltip title="URI webhook" side="bottom" portalToBody>
                Adresa unde Shopify trimite notificările pentru evenimente (produse, comenzi etc.).
                Trebuie să fie accesibilă public și să valideze HMAC pentru securitate. De exemplu,
                „https://app.neanelu.com/webhooks/shopify". Sfat: verifică că URL-ul răspunde cu 200
                OK la un GET simplu.
              </InfoTooltip>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">
              {webhookConfig?.appWebhookUrl ?? '—'}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/10 text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Topic</th>
                  <th className="px-3 py-2 text-left">Adresă</th>
                  <th className="px-3 py-2 text-left">Format</th>
                  <th className="px-3 py-2 text-left">Versiune API</th>
                </tr>
              </thead>
              <tbody className="">
                {webhookConfig?.webhooks.map((row, index) => (
                  <tr
                    key={`${row.topic}:${row.address}:${row.apiVersion ?? 'na'}:${index}`}
                    className="table-row-interactive border-t border-muted/20"
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
        </>
      )}
    </div>
  );
}
