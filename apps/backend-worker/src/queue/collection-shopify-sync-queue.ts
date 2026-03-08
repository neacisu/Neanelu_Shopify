import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;

function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const COLLECTION_SHOPIFY_SYNC_QUEUE_NAME = 'collection-shopify-sync';
export const COLLECTION_SHOPIFY_SYNC_JOB = 'sync-collection-to-shopify';

export type CollectionShopifySyncChangeType =
  | 'field_update'
  | 'taxonomy_assign'
  | 'taxonomy_unassign'
  | 'menu_assign';

export type CollectionShopifySyncMutation =
  | 'collectionUpdate'
  | 'metafieldsSet'
  | 'metafieldsDelete'
  | 'menuUpdate';

export interface CollectionShopifySyncJobData {
  shopId: string;
  changeId: string;
  collectionId: string;
  changeType: CollectionShopifySyncChangeType;
  fieldName?: string | null;
  newValue?: string | null;
  metadata: Record<string, unknown>;
  shopifyMutation: CollectionShopifySyncMutation | null;
}

type CollectionShopifySyncQueue = ReturnType<typeof createQueue>;

let collectionShopifySyncQueue: CollectionShopifySyncQueue | undefined;

function getCollectionShopifySyncQueue(): CollectionShopifySyncQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  collectionShopifySyncQueue ??= createQueue(qmOptions, {
    name: COLLECTION_SHOPIFY_SYNC_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  });
  return collectionShopifySyncQueue;
}

export async function enqueueCollectionShopifySyncJob(
  params: CollectionShopifySyncJobData
): Promise<string | undefined> {
  const queue = getCollectionShopifySyncQueue();
  const job = await queue.add(COLLECTION_SHOPIFY_SYNC_JOB, params, {
    jobId: `collection-shopify-sync-${params.changeId}`,
  });
  return job.id;
}

export async function closeCollectionShopifySyncQueue(): Promise<void> {
  if (collectionShopifySyncQueue) {
    await collectionShopifySyncQueue.close();
    collectionShopifySyncQueue = undefined;
  }
}
