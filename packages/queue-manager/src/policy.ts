import type { JobsProOptions } from '@taskforcesh/bullmq-pro';

import type { KnownQueueName } from './names.js';

export const NEANELU_BACKOFF_STRATEGY = 'neanelu-exp4' as const;

/**
 * Predictable backoff schedule: 1s → 4s → 16s (factor 4).
 *
 * NOTE: BullMQ calls the strategy for retries only.
 */
export function exp4BackoffMs(attemptsMade: number): number {
  // attemptsMade is 1 for the first retry.
  const retryIndex = Math.max(0, attemptsMade - 1);
  return 1000 * 4 ** retryIndex;
}

export type QueuePolicy = Readonly<{
  attempts: number;
  removeOnComplete: NonNullable<JobsProOptions['removeOnComplete']>;
  removeOnFail: NonNullable<JobsProOptions['removeOnFail']>;
  backoff: NonNullable<JobsProOptions['backoff']>;
}>;

export type QueueTimeoutsMs = Readonly<Record<KnownQueueName, number>>;

/**
 * Standardized job timeouts per queue (in milliseconds).
 *
 * NOTE: keep conservative defaults; callers can override per-job via `defaultJobOptions.timeout`.
 */
export const DEFAULT_QUEUE_TIMEOUTS_MS: QueueTimeoutsMs = {
  // Shopify webhooks should be fast; retries handle transient failures.
  'webhook-queue': 30_000,
  // Incremental sync can be slower (API + DB).
  'sync-queue': 5 * 60_000,
  // Bulk orchestration can be long-running (but still bounded).
  'bulk-queue': 30 * 60_000,
  // Poller jobs are short, but can be delayed/retried frequently.
  'bulk-poller-queue': 5 * 60_000,
  // Reconcile can involve downloading and parsing large JSONL files.
  'bulk-mutation-reconcile-queue': 30 * 60_000,
  // Bulk ingest jobs can trigger costly downstream processing.
  'bulk-ingest-queue': 15 * 60_000,
  // AI batch work tends to be longer.
  'ai-batch-queue': 10 * 60_000,
  // Enrichment jobs can be long-running (external APIs + scraping).
  'pim-enrichment-queue': 10 * 60_000,
  // Similarity search jobs hit external APIs, keep a moderate timeout.
  'pim-similarity-search': 10 * 60_000,
  // AI audit jobs can be slower due to model latency.
  'pim-ai-audit': 10 * 60_000,
  // Extraction jobs can include large HTML payloads and external model calls.
  'pim-extraction': 10 * 60_000,
  // Consensus is CPU-bound and DB-heavy but should stay bounded.
  'pim-consensus': 10 * 60_000,
  // MV refresh jobs run database functions and should complete quickly.
  'pim-mv-refresh-queue': 5 * 60_000,
} as const;

export function defaultJobTimeoutMs(queueName: KnownQueueName): number {
  return DEFAULT_QUEUE_TIMEOUTS_MS[queueName];
}

export function defaultQueuePolicy(): QueuePolicy {
  return {
    attempts: 3,
    // Keep completed jobs for 24h (age in seconds).
    removeOnComplete: { age: 86400 },
    // Keep failed jobs for 7 days (debugging).
    removeOnFail: { age: 604800 },
    backoff: {
      type: NEANELU_BACKOFF_STRATEGY,
      delay: 1000,
    },
  };
}
