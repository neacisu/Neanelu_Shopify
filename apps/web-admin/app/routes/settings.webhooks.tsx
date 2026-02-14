import { toast } from 'sonner';

import { WebhookConfigForm } from '../components/domain/WebhookConfigForm';
import { WebhookDeliveriesTable } from '../components/domain/WebhookDeliveriesTable';
import { WebhookTestPanel } from '../components/domain/WebhookTestPanel';
import { ErrorState } from '../components/patterns/error-state';
import { useQualityWebhookConfig } from '../hooks/use-quality-webhook-config';

export default function SettingsWebhooksPage() {
  const {
    config,
    deliveries,
    hasMoreDeliveries,
    loadMoreDeliveries,
    updateConfig,
    testWebhook,
    retryDelivery,
    isLoading,
    loadError,
    refresh,
  } = useQualityWebhookConfig();

  return (
    <div className="space-y-4">
      {loadError ? (
        <ErrorState
          message="Nu pot incarca setarile de webhook sau istoricul livrarilor."
          onRetry={() => {
            void refresh();
          }}
        />
      ) : null}
      <WebhookConfigForm
        initialConfig={config ?? null}
        isLoading={isLoading}
        onSave={async (payload) => {
          try {
            const result = await updateConfig(payload);
            toast.success('Configuratia webhook a fost salvata.');
            return result;
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Salvarea a esuat.');
            throw error;
          }
        }}
      />

      <WebhookTestPanel
        webhookUrl={config?.url ?? null}
        onTest={async (eventType) => {
          try {
            const result = await testWebhook({ eventType });
            if (result.ok) toast.success('Webhook de test trimis.');
            else toast.error(result.error ?? 'Webhook de test esuat.');
            return result;
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Webhook de test esuat.');
            throw error;
          }
        }}
      />

      <WebhookDeliveriesTable
        deliveries={deliveries}
        loading={isLoading}
        hasMore={hasMoreDeliveries}
        onLoadMore={async () => {
          try {
            await loadMoreDeliveries();
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : 'Nu pot incarca mai multe livrari.'
            );
            throw error;
          }
        }}
        onRetry={async (eventId) => {
          try {
            await retryDelivery(eventId);
            toast.success('Retry a fost pus in coada.');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Retry esuat.');
            throw error;
          }
        }}
      />
    </div>
  );
}
