import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_COLLECTION_METAFIELD_PUSH_QUEUE_NAME = 'pim-collection-metafield-push';
export const PIM_COLLECTION_METAFIELD_PUSH_JOB = 'push-collection-metafields';

type CollectionMetafieldPushQueue = ReturnType<typeof createQueue>;

let collectionMetafieldPushQueue: CollectionMetafieldPushQueue | undefined;

function getCollectionMetafieldPushQueue(): CollectionMetafieldPushQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  collectionMetafieldPushQueue ??= createQueue(qmOptions, {
    name: PIM_COLLECTION_METAFIELD_PUSH_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return collectionMetafieldPushQueue;
}

export async function enqueueCollectionMetafieldPushJob(params: {
  shopId: string;
  collectionId: string;
  trigger: 'category_classifier' | 'manual';
}) {
  const queue = getCollectionMetafieldPushQueue();
  const job = await queue.add(PIM_COLLECTION_METAFIELD_PUSH_JOB, params, {
    jobId: `pim-collection-metafield-${params.collectionId}`,
  });
  return job.id;
}

export async function closeCollectionMetafieldPushQueue(): Promise<void> {
  if (collectionMetafieldPushQueue) {
    await collectionMetafieldPushQueue.close();
    collectionMetafieldPushQueue = undefined;
  }
}
