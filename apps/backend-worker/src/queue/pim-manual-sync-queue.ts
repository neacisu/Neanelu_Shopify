import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_MANUAL_SYNC_QUEUE_NAME = 'pim-manual-sync';
export const PIM_MANUAL_SYNC_JOB_NAME = 'pim-manual-sync-run';

export type PimManualSyncJobPayload = Readonly<{
  shopId: string;
  bulkRunId: string;
  limit?: number;
  triggeredBy: 'manual';
  requestedAt: number;
}>;

type PimManualSyncQueue = ReturnType<typeof createQueue>;

let manualSyncQueue: PimManualSyncQueue | undefined;

function getManualSyncQueue(): PimManualSyncQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  manualSyncQueue ??= createQueue(qmOptions, {
    name: PIM_MANUAL_SYNC_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  });
  return manualSyncQueue;
}

export async function enqueuePimManualSyncJob(payload: PimManualSyncJobPayload): Promise<string> {
  const queue = getManualSyncQueue();
  const job = await queue.add(PIM_MANUAL_SYNC_JOB_NAME, payload, {
    jobId: `pim-manual-sync__${payload.shopId}__${payload.bulkRunId}__${payload.requestedAt}`,
  });
  return String(job.id);
}

export async function closePimManualSyncQueue(): Promise<void> {
  if (!manualSyncQueue) return;
  await manualSyncQueue.close();
  manualSyncQueue = undefined;
}
