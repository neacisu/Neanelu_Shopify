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
  const jobId = `pim-description-${params.productId}-${params.trigger}`;

  // BullMQ deduplicates by jobId against any key still in Redis — including
  // completed jobs kept by removeOnComplete:{count:1000}. Without this check
  // the job would be silently skipped and never re-run on a subsequent Force Sync.
  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'completed' || state === 'failed') {
      await existingJob.remove();
    } else {
      // Already waiting or active — deduplication is intentional.
      return existingJob.id;
    }
  }

  const job = await queue.add(PIM_DESCRIPTION_GENERATOR_JOB, params, { jobId });
  return job.id;
}

export async function closeDescriptionGeneratorQueue(): Promise<void> {
  if (descriptionGeneratorQueue) {
    await descriptionGeneratorQueue.close();
    descriptionGeneratorQueue = undefined;
  }
}
