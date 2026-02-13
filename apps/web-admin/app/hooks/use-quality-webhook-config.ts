import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { QualityEventType } from '@app/types';
import { useApiClient } from './use-api';

type QualityWebhookConfigDto = Readonly<{
  url: string | null;
  enabled: boolean;
  subscribedEvents: QualityEventType[];
  secretMasked: string | null;
  secretPlaintext?: string;
}>;

type DeliveryDto = Readonly<{
  id: string;
  eventId: string;
  eventType: string | null;
  url: string;
  httpStatus: number | null;
  durationMs: number | null;
  attempt: number;
  responseBody: string | null;
  errorMessage: string | null;
  createdAt: string;
}>;

type DeliveriesPage = Readonly<{
  deliveries: DeliveryDto[];
  totalCount: number;
  hasMore: boolean;
}>;

type UpdateWebhookConfigPayload = Readonly<{
  url: string;
  enabled: boolean;
  subscribedEvents: QualityEventType[];
  secret?: string;
  regenerateSecret?: boolean;
}>;

type TestWebhookPayload = Readonly<{ eventType: QualityEventType }>;
type TestWebhookResult = Readonly<{
  ok: boolean;
  httpStatus: number | null;
  responseTime: number;
  error?: string;
}>;
type RetryWebhookResult = Readonly<{ queued: boolean; jobId: string }>;

export type UseQualityWebhookConfigResult = Readonly<{
  config: QualityWebhookConfigDto | undefined;
  isLoading: boolean;
  deliveries: DeliveryDto[];
  hasMoreDeliveries: boolean;
  loadMoreDeliveries: () => Promise<void>;
  updateConfig: (payload: UpdateWebhookConfigPayload) => Promise<QualityWebhookConfigDto>;
  testWebhook: (payload: TestWebhookPayload) => Promise<TestWebhookResult>;
  retryDelivery: (eventId: string) => Promise<RetryWebhookResult>;
  refresh: () => Promise<void>;
}>;

export function useQualityWebhookConfig(): UseQualityWebhookConfigResult {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ['quality-webhook-config'],
    queryFn: () => api.getApi<QualityWebhookConfigDto>('/pim/webhooks/config'),
  });

  const deliveriesQuery = useInfiniteQuery({
    queryKey: ['quality-webhook-deliveries'],
    queryFn: ({ pageParam }) =>
      api.getApi<DeliveriesPage>(`/pim/webhooks/deliveries?limit=50&offset=${String(pageParam)}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, page) => sum + page.deliveries.length, 0);
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: (payload: UpdateWebhookConfigPayload) =>
      api.putApi<QualityWebhookConfigDto, UpdateWebhookConfigPayload>(
        '/pim/webhooks/config',
        payload
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['quality-webhook-config'], data);
      void queryClient.invalidateQueries({ queryKey: ['quality-webhook-deliveries'] });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: (payload: TestWebhookPayload) =>
      api.postApi<TestWebhookResult, TestWebhookPayload>('/pim/webhooks/test', payload),
  });

  const retryDeliveryMutation = useMutation({
    mutationFn: (eventId: string) =>
      api.postApi<RetryWebhookResult, Record<string, never>>(
        `/pim/webhooks/deliveries/${eventId}/retry`,
        {}
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quality-webhook-deliveries'] });
    },
  });

  const deliveries = useMemo(
    () => deliveriesQuery.data?.pages.flatMap((page) => page.deliveries) ?? [],
    [deliveriesQuery.data]
  );
  const loadMoreDeliveries = async (): Promise<void> => {
    await deliveriesQuery.fetchNextPage();
  };
  const updateConfig = async (
    payload: UpdateWebhookConfigPayload
  ): Promise<QualityWebhookConfigDto> => await updateConfigMutation.mutateAsync(payload);
  const testWebhook = async (payload: TestWebhookPayload): Promise<TestWebhookResult> =>
    await testWebhookMutation.mutateAsync(payload);
  const retryDelivery = async (eventId: string): Promise<RetryWebhookResult> =>
    await retryDeliveryMutation.mutateAsync(eventId);

  return {
    config: configQuery.data,
    isLoading: configQuery.isLoading || deliveriesQuery.isLoading,
    deliveries,
    hasMoreDeliveries: Boolean(deliveriesQuery.hasNextPage),
    loadMoreDeliveries,
    updateConfig,
    testWebhook,
    retryDelivery,
    refresh: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['quality-webhook-config'] }),
        queryClient.invalidateQueries({ queryKey: ['quality-webhook-deliveries'] }),
      ]);
    },
  };
}
