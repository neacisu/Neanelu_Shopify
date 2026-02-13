import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { getPendingWebhookEvents, markEventWebhookSent } from '@app/pim';
import {
  configFromEnv,
  createQueue,
  createWorker,
  withJobTelemetryContext,
} from '@app/queue-manager';
import { enqueueQualityWebhookJob } from '../../queue/quality-webhook-queue.js';
import {
  recordQualityWebhookSweepEvent,
  setQualityWebhookPendingTotal,
} from '../../otel/metrics.js';

export const QUALITY_WEBHOOK_SWEEP_QUEUE_NAME = 'pim-quality-webhook-sweep';
export const QUALITY_WEBHOOK_SWEEP_JOB_NAME = 'quality-webhook-sweep';

export interface QualityWebhookSweepHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

async function resolveShopIdForProduct(productId: string): Promise<string | null> {
  const result = await pool.query<{ shop_id: string }>(
    `SELECT pcm.shop_id
     FROM prod_channel_mappings pcm
     WHERE pcm.product_id = $1
       AND pcm.channel = 'shopify'
     LIMIT 1`,
    [productId]
  );
  return result.rows[0]?.shop_id ?? null;
}

async function runQualityWebhookSweep(logger: Logger): Promise<number> {
  const env = loadEnv();
  if (!env.qualityWebhookSweepEnabled) return 0;

  const pending = await getPendingWebhookEvents(100, env.qualityWebhookSweepMaxAgeDays);
  setQualityWebhookPendingTotal(pending.length);
  let scheduled = 0;
  for (const event of pending) {
    const shopId = await resolveShopIdForProduct(event.productId);
    if (!shopId) {
      await markEventWebhookSent(event.id);
      recordQualityWebhookSweepEvent('orphaned');
      logger.warn(
        { eventId: event.id, productId: event.productId },
        'No shop mapping found for product, marking webhook as sent'
      );
      continue;
    }

    await enqueueQualityWebhookJob({ eventId: event.id, shopId });
    recordQualityWebhookSweepEvent('scheduled');
    scheduled += 1;
  }

  if (pending.length > scheduled) {
    recordQualityWebhookSweepEvent('processed', pending.length - scheduled);
  }
  return scheduled;
}

export function startQualityWebhookSweepScheduler(logger: Logger): QualityWebhookSweepHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: QUALITY_WEBHOOK_SWEEP_QUEUE_NAME });

  void queue.add(
    QUALITY_WEBHOOK_SWEEP_JOB_NAME,
    {},
    {
      jobId: QUALITY_WEBHOOK_SWEEP_JOB_NAME,
      repeat: { pattern: '*/5 * * * *', tz: 'UTC' },
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 48 },
    }
  );

  const { worker } = createWorker(
    { config },
    {
      name: QUALITY_WEBHOOK_SWEEP_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => await runQualityWebhookSweep(logger)),
    }
  );

  return {
    worker,
    queue,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
