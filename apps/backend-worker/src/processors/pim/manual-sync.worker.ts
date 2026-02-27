import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';

import {
  PIM_MANUAL_SYNC_JOB_NAME,
  PIM_MANUAL_SYNC_QUEUE_NAME,
  type PimManualSyncJobPayload,
} from '../../queue/pim-manual-sync-queue.js';
import { runPimSyncFromBulkRun } from '../bulk-operations/pim/sync.js';

export interface PimManualSyncWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startPimManualSyncWorker(logger: Logger): PimManualSyncWorkerHandle {
  const env = loadEnv();

  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_MANUAL_SYNC_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          if (job.name !== PIM_MANUAL_SYNC_JOB_NAME) return;
          const payload = job.data as PimManualSyncJobPayload | null;
          if (!payload?.shopId || !payload?.bulkRunId) {
            throw new Error('invalid_pim_manual_sync_payload');
          }

          logger.info(
            {
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
            },
            'PIM manual sync started'
          );

          await runPimSyncFromBulkRun({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
            logger,
          });

          logger.info(
            {
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
            },
            'PIM manual sync completed'
          );
        }),
    }
  );

  return { worker, close: () => worker.close() };
}
