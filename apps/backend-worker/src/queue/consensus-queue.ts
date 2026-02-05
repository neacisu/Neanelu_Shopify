import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const CONSENSUS_QUEUE_NAME = 'pim-consensus';
export const CONSENSUS_JOB_SINGLE = 'compute-consensus-single';
export const CONSENSUS_JOB_BATCH = 'compute-consensus-batch';
export const CONSENSUS_JOB_RECOMPUTE = 'recompute-after-match-confirm';

type ConsensusQueue = ReturnType<typeof createQueue>;

let consensusQueue: ConsensusQueue | undefined;

function getConsensusQueue(): ConsensusQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  consensusQueue ??= createQueue(qmOptions, {
    name: CONSENSUS_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 200 },
    },
  });
  return consensusQueue;
}

export async function enqueueConsensusJob(params: {
  shopId: string;
  productId: string;
  trigger: 'match_confirmed' | 'extraction_complete' | 'manual' | 'batch';
}) {
  const queue = getConsensusQueue();
  const job = await queue.add(CONSENSUS_JOB_SINGLE, params, {
    jobId: `consensus:${params.productId}:${Date.now()}`,
  });
  return job.id;
}

export async function enqueueConsensusBatchJob(params: { shopId: string; productIds: string[] }) {
  const queue = getConsensusQueue();
  const job = await queue.add(CONSENSUS_JOB_BATCH, params);
  return job.id;
}

export async function closeConsensusQueue(): Promise<void> {
  if (consensusQueue) {
    await consensusQueue.close();
    consensusQueue = undefined;
  }
}
