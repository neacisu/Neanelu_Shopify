import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import {
  configFromEnv,
  createQueue,
  createWorker,
  enqueueEnrichmentJob,
  withJobTelemetryContext,
} from '@app/queue-manager';

export const AUTO_ENRICHMENT_SCHEDULER_QUEUE_NAME = 'pim-auto-enrichment-scheduler-queue';
export const AUTO_ENRICHMENT_SCHEDULER_JOB_NAME = 'pim.enrichment.auto-scan';

export interface AutoEnrichmentSchedulerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

export async function runAutoEnrichmentTick(params: {
  logger: Logger;
  maxShops?: number;
  perShopLimit?: number;
}): Promise<{ shopsScanned: number; jobsEnqueued: number; productsEnqueued: number }> {
  const maxShops = Math.max(1, Math.min(500, params.maxShops ?? 100));
  const perShopLimit = Math.max(1, Math.min(250, params.perShopLimit ?? 25));

  const shops = await pool.query<{ id: string }>(
    `SELECT id
       FROM shops
      WHERE uninstalled_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1`,
    [maxShops]
  );

  let jobsEnqueued = 0;
  let productsEnqueued = 0;
  let shopIdx = 0;

  for (const shop of shops.rows) {
    shopIdx += 1;
    const candidates = await pool.query<{ id: string }>(
      `SELECT sp.id
         FROM prod_channel_mappings pcm
         JOIN shopify_products sp
           ON sp.shopify_gid = pcm.external_id
          AND sp.shop_id = $1
         JOIN prod_master pm
           ON pm.id = pcm.product_id
         LEFT JOIN prod_specs_normalized psn
           ON psn.product_id = pm.id
          AND psn.is_current = true
        WHERE pcm.shop_id = $1
          AND pcm.channel = 'shopify'
          AND pm.data_quality_level = 'bronze'
          AND (psn.id IS NULL OR psn.updated_at < now() - interval '7 days')
        ORDER BY pm.updated_at ASC NULLS LAST
        LIMIT $2`,
      [shop.id, perShopLimit]
    );

    if (candidates.rows.length === 0) continue;

    const requestedAt = Date.now() + shopIdx;
    await enqueueEnrichmentJob(
      {
        shopId: shop.id,
        productIds: candidates.rows.map((row) => row.id),
        triggeredBy: 'scheduler',
        requestedAt,
        priority: 3,
      },
      params.logger as unknown as Parameters<typeof enqueueEnrichmentJob>[1]
    );

    jobsEnqueued += 1;
    productsEnqueued += candidates.rows.length;
  }

  params.logger.info(
    { shopsScanned: shops.rows.length, jobsEnqueued, productsEnqueued },
    'Auto enrichment tick completed'
  );
  return { shopsScanned: shops.rows.length, jobsEnqueued, productsEnqueued };
}

export function startAutoEnrichmentScheduler(logger: Logger): AutoEnrichmentSchedulerHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: AUTO_ENRICHMENT_SCHEDULER_QUEUE_NAME });

  void queue.add(
    AUTO_ENRICHMENT_SCHEDULER_JOB_NAME,
    {},
    {
      jobId: AUTO_ENRICHMENT_SCHEDULER_JOB_NAME,
      repeat: { pattern: '*/10 * * * *', tz: 'UTC' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  const { worker } = createWorker(
    { config },
    {
      name: AUTO_ENRICHMENT_SCHEDULER_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => await runAutoEnrichmentTick({ logger })),
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
