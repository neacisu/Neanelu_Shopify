import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_METAFIELD_PUSH_QUEUE_NAME = 'pim-metafield-push';
export const PIM_METAFIELD_PUSH_JOB = 'push-product-metafields';

type MetafieldPushQueue = ReturnType<typeof createQueue>;

let metafieldPushQueue: MetafieldPushQueue | undefined;

function getMetafieldPushQueue(): MetafieldPushQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  metafieldPushQueue ??= createQueue(qmOptions, {
    name: PIM_METAFIELD_PUSH_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return metafieldPushQueue;
}

export async function enqueueMetafieldPushJob(params: {
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}) {
  const queue = getMetafieldPushQueue();
  const job = await queue.add(PIM_METAFIELD_PUSH_JOB, params, {
    jobId: `pim-metafield-${params.productId}-${params.trigger}`,
  });
  return job.id;
}

export async function closeMetafieldPushQueue(): Promise<void> {
  if (metafieldPushQueue) {
    await metafieldPushQueue.close();
    metafieldPushQueue = undefined;
  }
}
