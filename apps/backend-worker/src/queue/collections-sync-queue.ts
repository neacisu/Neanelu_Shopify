import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_COLLECTIONS_SYNC_QUEUE_NAME = 'pim-collections-sync';
export const PIM_COLLECTIONS_SYNC_JOB = 'sync-shopify-collections';

type CollectionsSyncQueue = ReturnType<typeof createQueue>;

let collectionsSyncQueue: CollectionsSyncQueue | undefined;

function getCollectionsSyncQueue(): CollectionsSyncQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  collectionsSyncQueue ??= createQueue(qmOptions, {
    name: PIM_COLLECTIONS_SYNC_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return collectionsSyncQueue;
}

export async function enqueueCollectionsSyncJob(params: {
  shopId: string;
  trigger: 'manual' | 'scheduled';
}) {
  const queue = getCollectionsSyncQueue();
  const jobId = `pim-collections-sync-${params.shopId}`;
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'completed' || state === 'failed') {
      await existingJob.remove();
    } else {
      return existingJob.id;
    }
  }

  const job = await queue.add(PIM_COLLECTIONS_SYNC_JOB, params, {
    jobId,
  });
  return job.id;
}

export async function closeCollectionsSyncQueue(): Promise<void> {
  if (collectionsSyncQueue) {
    await collectionsSyncQueue.close();
    collectionsSyncQueue = undefined;
  }
}
