export const QUEUE_NAMES = [
  'webhook-queue',
  'sync-queue',
  'bulk-queue',
  'bulk-poller-queue',
  'bulk-mutation-reconcile-queue',
  'bulk-ingest-queue',
  'ai-batch-queue',
  'pim-enrichment-queue',
  'pim-similarity-search',
  'pim-ai-audit',
  'pim-extraction',
  'pim-consensus',
] as const;

export type KnownQueueName = (typeof QUEUE_NAMES)[number];

export const COST_SENSITIVE_QUEUE_NAMES = [
  'ai-batch-queue',
  'bulk-ingest-queue',
  'pim-enrichment-queue',
  'pim-similarity-search',
  'pim-ai-audit',
  'pim-extraction',
] as const satisfies readonly KnownQueueName[];

export type CostSensitiveQueueName = (typeof COST_SENSITIVE_QUEUE_NAMES)[number];

export function toDlqQueueName(queueName: string): string {
  const normalized = queueName.trim();
  if (!normalized) {
    throw new Error('queue_name_empty');
  }

  if (normalized.endsWith('-dlq')) return normalized;
  return `${normalized}-dlq`;
}
