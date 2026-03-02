import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const PIM_DESCRIPTION_GENERATOR_QUEUE_NAME = 'pim-description-generator';
export const PIM_DESCRIPTION_GENERATOR_JOB = 'generate-description';

type DescriptionGeneratorQueue = ReturnType<typeof createQueue>;

let descriptionGeneratorQueue: DescriptionGeneratorQueue | undefined;

function getDescriptionGeneratorQueue(): DescriptionGeneratorQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  descriptionGeneratorQueue ??= createQueue(qmOptions, {
    name: PIM_DESCRIPTION_GENERATOR_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return descriptionGeneratorQueue;
}

export async function enqueueDescriptionGeneratorJob(params: {
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}) {
  const queue = getDescriptionGeneratorQueue();
  const job = await queue.add(PIM_DESCRIPTION_GENERATOR_JOB, params, {
    jobId: `pim-description-${params.productId}-${params.trigger}`,
  });
  return job.id;
}

export async function closeDescriptionGeneratorQueue(): Promise<void> {
  if (descriptionGeneratorQueue) {
    await descriptionGeneratorQueue.close();
    descriptionGeneratorQueue = undefined;
  }
}
