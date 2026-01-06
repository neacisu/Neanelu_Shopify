/**
 * Token Health Worker
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Runs periodic token health check batches
 */

import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { ShopifyRateLimitedError } from '@app/shopify-client';
import { checkAndConsumeCost, configFromEnv, createQueue, createWorker } from '@app/queue-manager';
import { Redis as IORedis } from 'ioredis';

import {
  createTokenHealthJobConfig,
  TOKEN_HEALTH_JOB_NAME,
  TOKEN_HEALTH_SHOP_JOB_NAME,
  type TokenHealthJobData,
  type TokenHealthShopJobData,
} from '../../auth/jobs/token-health-job.js';

import { TOKEN_HEALTH_QUEUE_NAME } from '../../queue/token-health-queue.js';
import {
  getShopsForHealthCheck,
  checkTokenHealth,
  markNeedsReauth,
} from '../../auth/token-lifecycle.js';

const env = loadEnv();

export interface TokenHealthWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

async function closeWithTimeout(label: string, fn: () => Promise<void>, timeoutMs: number) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs).unref();
  });
  await Promise.race([fn(), timeout]);
}

function startTokenHealthWorker(logger: Logger): TokenHealthWorkerHandle {
  const qmOptions = { config: configFromEnv(env) };
  const redis = new IORedis(env.redisUrl);

  // Ensure the queue exists (used for fan-out scheduling).
  const queue = createQueue(qmOptions, { name: TOKEN_HEALTH_QUEUE_NAME });

  const { worker } = createWorker<TokenHealthJobData | TokenHealthShopJobData>(qmOptions, {
    name: TOKEN_HEALTH_QUEUE_NAME,
    enableDelayHandling: true,
    processor: async (job) => {
      if (job.name === TOKEN_HEALTH_JOB_NAME) {
        // Fan-out scheduler job: enqueue per-shop checks so each shop can be delayed independently.
        const config = createTokenHealthJobConfig(env.encryptionKeyHex);
        const shopIds = await getShopsForHealthCheck(config.batchSize);

        for (const shopId of shopIds) {
          await queue.add(
            TOKEN_HEALTH_SHOP_JOB_NAME,
            {
              shopId,
              triggeredBy: 'scheduler',
              timestamp: Date.now(),
            },
            {
              // Stable id per shop per run (avoid duplicate fan-out floods).
              jobId: `token-health:${shopId}:${Math.floor(Date.now() / 1000)}`,
              removeOnComplete: 50,
              removeOnFail: 200,
              attempts: 1,
            }
          );
        }

        logger.info({ count: shopIds.length }, 'Token health fan-out enqueued');
        return;
      }

      if (job.name !== TOKEN_HEALTH_SHOP_JOB_NAME) return;

      const data = job.data as TokenHealthShopJobData;
      const shopId = data.shopId;

      // Proactive REST rate limit gating (per shop) before calling Shopify.
      const bucketKey = `neanelu:ratelimit:rest:${shopId}`;
      const gate = await checkAndConsumeCost(redis, {
        bucketKey,
        costToConsume: 1,
        maxTokens: 40,
        refillPerSecond: 2,
        ttlMs: 10 * 60 * 1000,
      });

      if (!gate.allowed) {
        throw new ShopifyRateLimitedError({ kind: 'preflight', delayMs: gate.delayMs });
      }

      const config = createTokenHealthJobConfig(env.encryptionKeyHex);
      const health = await checkTokenHealth(shopId, config.encryptionKey, logger);

      if (!health.valid && health.needsReauth) {
        await markNeedsReauth(shopId, health.reason ?? 'Health check failed');
      }
    },
    workerOptions: {
      concurrency: 1,
    },
  });

  const close = async (): Promise<void> => {
    await closeWithTimeout(
      'token-health worker shutdown',
      async () => {
        const pause = (
          worker as unknown as { pause?: (doNotWaitActive?: boolean) => Promise<void> }
        ).pause;
        if (typeof pause === 'function') {
          await pause.call(worker, false).catch(() => {
            // best-effort
          });
        }

        await worker.close();
        await queue.close();
        await redis.quit();
      },
      10_000
    );
  };

  return { worker, close };
}

export { startTokenHealthWorker };
