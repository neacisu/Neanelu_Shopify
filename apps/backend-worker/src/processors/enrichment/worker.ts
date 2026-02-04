import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { Redis as IORedis } from 'ioredis';
import { withTenantContext } from '@app/database';
import {
  ENRICHMENT_JOB_NAME,
  ENRICHMENT_QUEUE_NAME,
  configFromEnv,
  createWorker,
  type DlqQueueLike,
  type DlqEntry,
  withJobTelemetryContext,
} from '@app/queue-manager';
import type { EnrichmentJobPayload } from '@app/types';
import { EnrichmentOrchestrator } from '@app/pim';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueSimilaritySearchJob } from '../../queue/similarity-queues.js';

export interface EnrichmentWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
  dlqQueue: DlqQueueLike | undefined;
}

export function startEnrichmentWorker(logger: Logger): EnrichmentWorkerHandle {
  const env = loadEnv();
  const redis = new IORedis(env.redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
  const orchestrator = new EnrichmentOrchestrator(redis, logger, enqueueSimilaritySearchJob);
  const { worker, dlqQueue } = createWorker(
    { config: configFromEnv(env) },
    {
      name: ENRICHMENT_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      workerOptions: {
        concurrency: env.enrichmentWorkerConcurrency ?? env.maxGlobalConcurrency,
        group: { concurrency: env.maxActivePerShop },
      },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('enrichment-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== ENRICHMENT_JOB_NAME) {
              throw new Error(`unknown_enrichment_job:${job.name}`);
            }

            const payload = job.data as EnrichmentJobPayload;
            if (!payload?.shopId || !Array.isArray(payload.productIds)) {
              throw new Error('invalid_enrichment_payload');
            }

            const products = await fetchProductsForEnrichment(payload.shopId, payload.productIds);

            if (products.length === 0) {
              logger.info(
                { shopId: payload.shopId, originalCount: payload.productIds.length },
                'No products found for enrichment'
              );
              return { dispatched: 0, skipped: payload.productIds.length };
            }

            const result = await orchestrator.dispatchForEnrichment(payload.shopId, products);

            logger.info({ shopId: payload.shopId, ...result }, 'Enrichment batch dispatched');
            return result;
          } finally {
            clearWorkerCurrentJob('enrichment-worker', jobId);
          }
        }),
      onDlqEntry: (entry: DlqEntry) => {
        logger.error({ entry }, 'Enrichment job moved to DLQ');
      },
    }
  );

  return {
    worker,
    dlqQueue,
    close: async () => {
      await worker.close();
      await redis.quit();
      if (dlqQueue && 'close' in dlqQueue) {
        await (dlqQueue as { close: () => Promise<void> }).close();
      }
    },
  };
}

async function fetchProductsForEnrichment(
  shopId: string,
  productIds: string[]
): Promise<
  {
    productId: string;
    shopifyProductId: string;
    qualityScore: number | null;
    gtin: string | null;
    dataQualityLevel: string | null;
  }[]
> {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      product_id: string;
      shopify_product_id: string;
      quality_score: string | null;
      gtin: string | null;
      data_quality_level: string | null;
    }>(
      `SELECT pm.id as product_id,
              sp.id as shopify_product_id,
              pm.quality_score,
              pm.gtin,
              pm.data_quality_level
         FROM prod_channel_mappings pcm
         JOIN shopify_products sp
           ON sp.shopify_gid = pcm.external_id
          AND sp.shop_id = $1
         JOIN prod_master pm
           ON pm.id = pcm.product_id
        WHERE pcm.channel = 'shopify'
          AND pcm.shop_id = $1
          AND sp.id = ANY($2::uuid[])`,
      [shopId, productIds]
    );

    return result.rows.map((row) => ({
      productId: row.product_id,
      shopifyProductId: row.shopify_product_id,
      qualityScore: row.quality_score ? Number(row.quality_score) : null,
      gtin: row.gtin,
      dataQualityLevel: row.data_quality_level,
    }));
  });
}
