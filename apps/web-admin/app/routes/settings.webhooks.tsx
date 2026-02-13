import { toast } from 'sonner';

import { WebhookConfigForm } from '../components/domain/WebhookConfigForm';
import { WebhookDeliveriesTable } from '../components/domain/WebhookDeliveriesTable';
import { WebhookTestPanel } from '../components/domain/WebhookTestPanel';
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
  } = useQualityWebhookConfig();

  return (
    <div className="space-y-4">
      <WebhookConfigForm
        initialConfig={config ?? null}
        isLoading={isLoading}
        onSave={async (payload) => {
          const result = await updateConfig(payload);
          toast.success('Webhook configuration saved');
          return result;
        }}
      />

      <WebhookTestPanel
        webhookUrl={config?.url ?? null}
        onTest={async (eventType) => {
          const result = await testWebhook({ eventType });
          if (result.ok) toast.success('Test webhook sent');
          else toast.error(result.error ?? 'Test webhook failed');
          return result;
        }}
      />

      <WebhookDeliveriesTable
        deliveries={deliveries}
        loading={isLoading}
        hasMore={hasMoreDeliveries}
        onLoadMore={async () => {
          await loadMoreDeliveries();
        }}
        onRetry={async (eventId) => {
          await retryDelivery(eventId);
          toast.success('Retry job queued');
        }}
      />
    </div>
  );
}
