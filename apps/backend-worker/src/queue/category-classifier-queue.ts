import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_CATEGORY_CLASSIFIER_QUEUE_NAME = 'pim-category-classifier';
export const PIM_CATEGORY_CLASSIFIER_JOB = 'classify-product-taxonomy';

type CategoryClassifierQueue = ReturnType<typeof createQueue>;

let categoryClassifierQueue: CategoryClassifierQueue | undefined;

function getCategoryClassifierQueue(): CategoryClassifierQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  categoryClassifierQueue ??= createQueue(qmOptions, {
    name: PIM_CATEGORY_CLASSIFIER_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return categoryClassifierQueue;
}

export async function enqueueCategoryClassifierJob(params: {
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}) {
  const queue = getCategoryClassifierQueue();
  const job = await queue.add(PIM_CATEGORY_CLASSIFIER_JOB, params, {
    jobId: `pim-category-${params.productId}-${params.trigger}`,
  });
  return job.id;
}

export async function closeCategoryClassifierQueue(): Promise<void> {
  if (categoryClassifierQueue) {
    await categoryClassifierQueue.close();
    categoryClassifierQueue = undefined;
  }
}
