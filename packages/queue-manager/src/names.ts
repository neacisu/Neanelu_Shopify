export const QUEUE_NAMES = [
  'webhook-queue',
  'sync-queue',
  'bulk-queue',
  'bulk-poller-queue',
  'bulk-mutation-reconcile-queue',
  'bulk-ingest-queue',
  'pim-manual-sync',
  'ai-batch-queue',
  'pim-enrichment-queue',
  'pim-similarity-search',
  'pim-ai-audit',
  'pim-extraction',
  'pim-consensus',
  'pim-quality-webhook',
  'pim-quality-webhook-sweep',
  'pim-budget-reset-queue',
  'pim-weekly-summary-queue',
  'pim-auto-enrichment-scheduler-queue',
  'pim-raw-harvest-retention-queue',
  'pim-mv-refresh-queue',
  'pim-category-classifier',
  'pim-description-generator',
  'pim-metafield-push',
  'pim-collection-metafield-push',
  'pim-collections-sync',
  'lex.extract.fragments',
  'lex.extract.entities',
  'lex.mine.terms',
  'lex.aggregate.stats',
  'lex.build.contexts',
  'lex.embed.contexts',
  'lex.cluster.senses',
  'lex.resolve.attributes',
  'lex.translate.candidates',
  'lex.compose.localizations',
  'lex.review.enqueue',
  'lex.publish',
  'lex.retention.compact',
] as const;

export type KnownQueueName = (typeof QUEUE_NAMES)[number];

export const COST_SENSITIVE_QUEUE_NAMES = [
  'ai-batch-queue',
  'bulk-ingest-queue',
  'pim-enrichment-queue',
  'pim-similarity-search',
  'pim-ai-audit',
  'pim-extraction',
  'lex.embed.contexts',
  'lex.translate.candidates',
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
