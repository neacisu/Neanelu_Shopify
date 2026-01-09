/**
 * Sync Worker (Manual Sync)
 *
 * CONFORM: Plan_de_implementare F3.6.2
 * - Supports the Dashboard "Start Sync" quick action.
 * - For MVP, performs a safe, idempotent sync: webhook reconciliation.
 */

import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { Redis as IORedis } from 'ioredis';

import { createTokenHealthJobConfig } from '../../auth/jobs/token-health-job.js';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { reconcileWebhooks } from '../../shopify/webhooks/register.js';
import { incrementDashboardActivity } from '../../runtime/dashboard-activity.js';

const env = loadEnv();

export const SYNC_QUEUE_NAME = 'sync-queue';
export const MANUAL_SYNC_JOB_NAME = 'manual-sync';

export interface SyncWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startSyncWorker(logger: Logger): SyncWorkerHandle {
  const qmOptions = { config: configFromEnv(env) };
  const redis = new IORedis(env.redisUrl);

  const { worker } = createWorker<{ shopId: string; requestedAt?: number }>(qmOptions, {
    name: SYNC_QUEUE_NAME,
    processor: async (job) => {
      return withJobTelemetryContext(job, async () => {
        const data = job.data as { shopId?: unknown };
        const shopId = typeof data.shopId === 'string' && data.shopId.trim() ? data.shopId : null;
        if (!shopId) {
          throw new Error('missing_shopId');
        }

        const config = createTokenHealthJobConfig(env.encryptionKeyHex);

        try {
          await withTokenRetry(
            shopId,
            config.encryptionKey,
            logger,
            async (accessToken, shopDomain) => {
              await reconcileWebhooks(shopId, shopDomain, accessToken, env.appHost.host, logger);
            }
          );
        } finally {
          // Count this job as processed for the activity timeline (best-effort).
          await incrementDashboardActivity(redis, 'sync', 1).catch(() => undefined);
        }
      });
    },
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await redis.quit().catch(() => undefined);
  };

  return { worker, close };
}
