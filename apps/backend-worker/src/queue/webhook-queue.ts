/**
 * Minimal Webhook Queue (Bootstrap for F3.3)
 *
 * CONFORM: Plan_de_implementare F3.3.3
 * - BullMQ OSS (no Pro features yet)
 * - Minimal producer
 * - To be refactored in F4.1
 */

import { Queue } from 'bullmq';
import { loadEnv } from '@app/config';
import type { WebhookJobPayload } from '@app/types';
import type { Logger } from '@app/logger';

const env = loadEnv();

// Queue name constant
export const WEBHOOK_QUEUE_NAME = 'webhooks';

let webhookQueue: Queue<WebhookJobPayload> | undefined;

/**
 * Lazy initialize the queue
 */
function getQueue(): Queue<WebhookJobPayload> {
  webhookQueue ??= new Queue<WebhookJobPayload>(WEBHOOK_QUEUE_NAME, {
    connection: {
      url: env.redisUrl,
    },
    defaultJobOptions: {
      removeOnComplete: 100, // Keep last 100 completed
      removeOnFail: 1000, // Keep last 1000 failed for debug
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });
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
    logger.error({ err: err as Error, payload }, 'Failed to enqueue webhook job');
    throw err;
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
