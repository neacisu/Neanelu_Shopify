export const QUEUE_NAMES = ['webhook-queue', 'sync-queue', 'bulk-queue', 'ai-batch-queue'] as const;

export type KnownQueueName = (typeof QUEUE_NAMES)[number];

export function toDlqQueueName(queueName: string): string {
  const normalized = queueName.trim();
  if (!normalized) {
    throw new Error('queue_name_empty');
  }

  if (normalized.endsWith('-dlq')) return normalized;
  return `${normalized}-dlq`;
}
