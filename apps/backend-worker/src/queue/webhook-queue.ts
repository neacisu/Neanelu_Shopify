/**
 * Webhook Queue Producer
 *
 * Uses `@app/queue-manager` (BullMQ Pro) as the single source of truth for
 * queue infrastructure.
 */

import { loadEnv } from '@app/config';
import { configFromEnv, createQueue } from '@app/queue-manager';
import type { WebhookJobPayload } from '@app/types';
import type { Logger } from '@app/logger';

const env = loadEnv();

// Queue name constant
export const WEBHOOK_QUEUE_NAME = 'webhook-queue';

let webhookQueue: ReturnType<typeof createQueue> | undefined;

/**
 * Lazy initialize the queue
 */
function getQueue(): ReturnType<typeof createQueue> {
  webhookQueue ??= createQueue(
    { config: configFromEnv(env) },
    {
      name: WEBHOOK_QUEUE_NAME,
    }
  );

  return webhookQueue;
}

/**
 * Enqueue a webhook job
 *
 * @param payload - The webhook payload
 * @param logger - Logger instance
 */
export async function enqueueWebhookJob(payload: WebhookJobPayload, logger: Logger): Promise<void> {
  const queue = getQueue();

  try {
    await queue.add(payload.topic, payload, {
      ...(payload.webhookId ? { jobId: payload.webhookId } : {}), // Use webhook ID as job ID for extra dedupe safety
    });

    logger.info(
      {
        topic: payload.topic,
        webhookId: payload.webhookId,
        shop: payload.shopDomain,
      },
      'Webhook enqueued successfully'
    );
  } catch (err) {
    // Aici e critic: dacă nu putem pune în coadă, trebuie să returnăm eroare
    // ca Shopify să reîncerce mai târziu
    const error = err instanceof Error ? err : new Error('unknown_error');
    logger.error({ err: error, payload }, 'Failed to enqueue webhook job');
    throw error;
  }
}

/**
 * Close queue connection (graceful shutdown)
 */
export async function closeWebhookQueue(): Promise<void> {
  if (webhookQueue) {
    await webhookQueue.close();
    webhookQueue = undefined;
  }
}

/**
 * Best-effort cleanup for a shop's queued webhook jobs.
 *
 * CONFORM: Plan_de_implementare F3.3.5 (cleanup on uninstall)
 */
export async function cleanupWebhookJobsForShopDomain(
  shopDomain: string,
  logger: Logger
): Promise<{ removed: number }> {
  const queue = getQueue();

  // Limit scanning so uninstall doesn't become unbounded work.
  const maxJobsToScan = 2000;
  const pageSize = 200;

  let removed = 0;
  let scanned = 0;

  for (const state of ['waiting', 'delayed', 'prioritized', 'paused'] as const) {
    // Scan in pages; BullMQ uses [start, end] indexes.
    for (let start = 0; start < maxJobsToScan; start += pageSize) {
      const end = Math.min(start + pageSize - 1, maxJobsToScan - 1);
      const jobs = await queue.getJobs([state], start, end, true);
      if (jobs.length === 0) break;

      for (const job of jobs) {
        scanned += 1;
        if (scanned > maxJobsToScan) break;

        if (job.data?.shopDomain === shopDomain) {
          try {
            await job.remove();
            removed += 1;
          } catch (err) {
            logger.warn({ err, jobId: job.id, shop: shopDomain }, 'Failed removing webhook job');
          }
        }
      }

      if (scanned > maxJobsToScan) break;
      if (jobs.length < pageSize) break;
    }
  }

  logger.info({ shop: shopDomain, removed }, 'Webhook job cleanup finished');
  return { removed };
}
