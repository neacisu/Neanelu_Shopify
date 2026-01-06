import { loadEnv } from '@app/config';
import type { WebhookJobPayload } from '@app/types';

import { configFromEnv, createQueue, type QueueManagerConfig } from './queue-manager.js';

export type LoggerLike = Readonly<{
  // Common denominator between Fastify/Pino and our Logger.
  // This keeps call-sites consistent and avoids strictFunctionTypes variance issues.
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}>;

export const WEBHOOK_QUEUE_NAME = 'webhook-queue';

let cachedConfig: QueueManagerConfig | null = null;
let webhookQueue: ReturnType<typeof createQueue> | undefined;

function getConfig(): QueueManagerConfig {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  cachedConfig = configFromEnv(env);
  return cachedConfig;
}

function getQueue(): ReturnType<typeof createQueue> {
  webhookQueue ??= createQueue(
    { config: getConfig() },
    {
      name: WEBHOOK_QUEUE_NAME,
    }
  );

  return webhookQueue;
}

export async function enqueueWebhookJob(
  payload: WebhookJobPayload,
  logger: LoggerLike
): Promise<void> {
  const queue = getQueue();

  try {
    await queue.add(payload.topic, payload, {
      ...(payload.webhookId ? { jobId: payload.webhookId } : {}),
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
    const error = err instanceof Error ? err : new Error('unknown_error');
    logger.error(
      {
        err: error,
        topic: payload.topic,
        webhookId: payload.webhookId,
        shop: payload.shopDomain,
      },
      'Failed to enqueue webhook job'
    );
    throw error;
  }
}

export async function closeWebhookQueue(): Promise<void> {
  if (!webhookQueue) return;
  await webhookQueue.close();
  webhookQueue = undefined;
}

export async function cleanupWebhookJobsForShopDomain(
  shopDomain: string,
  logger: LoggerLike
): Promise<{ removed: number }> {
  const queue = getQueue();

  const maxJobsToScan = 2000;
  const pageSize = 200;

  let removed = 0;
  let scanned = 0;

  for (const state of ['waiting', 'delayed', 'prioritized', 'paused'] as const) {
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
