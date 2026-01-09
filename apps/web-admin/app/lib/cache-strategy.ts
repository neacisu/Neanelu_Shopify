import { queryClient } from './query-client';

/**
 * Standard Cache Keys pentru React Query.
 * Folosiți aceste chei pentru consistență în invalidare.
 */
export const QueryKeys = {
  // Jobs & Queues
  jobs: (queueName?: string) => (queueName ? ['jobs', queueName] : ['jobs']),
  job: (id: string | number) => ['job', String(id)],
  queues: ['queues'],
  queueMetrics: (queueName: string) => ['queueMetrics', queueName],

  // Products
  products: ['products'],
  product: (id: string | number) => ['product', String(id)],

  // Settings
  settings: ['settings'],

  // Webhooks
  webhooks: ['webhooks'],
} as const;

/**
 * Helper pentru invalidarea granulară a query-urilor.
 * Wrapper peste queryClient.invalidateQueries.
 *
 * @example
 * // Invalidează toate job-urile
 * await invalidateQueries(QueryKeys.jobs());
 *
 * // Invalidează doar un job specific
 * await invalidateQueries(QueryKeys.job('123'));
 */
export async function invalidateQueries(queryKey: unknown[]): Promise<void> {
  await queryClient.invalidateQueries({ queryKey });
}

/**
 * Helper pentru setarea datelor în cache (optimistic update manual).
 *
 * @param queryKey - Cheia query-ului
 * @param updater - Funcție sau valoare nouă
 */
export function setQueryData<T>(
  queryKey: unknown[],
  updater: T | ((prev: T | undefined) => T)
): void {
  queryClient.setQueryData(queryKey, updater);
}
