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

export type ConsensusEnqueueTrigger =
  | 'match_confirmed'
  | 'extraction_complete'
  | 'manual'
  | 'batch'
  | 'direct_sync'
  | 'similarity_complete'
  | 'ai_audit_complete'
  | 'extraction_failed';

export type ConsensusJobLane = 'bootstrap' | 'settlement' | 'manual' | 'batch';

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

export function getConsensusJobLane(trigger: ConsensusEnqueueTrigger): ConsensusJobLane {
  if (trigger === 'direct_sync') {
    return 'bootstrap';
  }
  if (trigger === 'manual') {
    return 'manual';
  }
  if (trigger === 'batch') {
    return 'batch';
  }
  return 'settlement';
}

export function buildConsensusLaneJobId(productId: string, lane: ConsensusJobLane): string {
  return `consensus:${productId}:${lane}`;
}

export function buildConsensusJobId(params: {
  productId: string;
  trigger: ConsensusEnqueueTrigger;
}): string {
  return buildConsensusLaneJobId(params.productId, getConsensusJobLane(params.trigger));
}

export async function enqueueConsensusJob(params: {
  shopId: string;
  productId: string;
  trigger: ConsensusEnqueueTrigger;
}) {
  const queue = getConsensusQueue();
  const jobId = buildConsensusJobId({ productId: params.productId, trigger: params.trigger });

  // Deduplicate consensus per product lane. We keep direct-sync bootstrap isolated from
  // post-automation settlement so a later similarity/extraction completion can still queue
  // a follow-up consensus, while near-simultaneous settlement events collapse into one job.
  const existingJob = await queue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'completed' || state === 'failed') {
      await existingJob.remove();
    } else {
      return existingJob.id;
    }
  }

  const job = await queue.add(CONSENSUS_JOB_SINGLE, params, { jobId });
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
