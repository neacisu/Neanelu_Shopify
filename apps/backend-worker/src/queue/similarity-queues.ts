import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const SIMILARITY_SEARCH_QUEUE_NAME = 'pim-similarity-search';
export const SIMILARITY_SEARCH_JOB = 'search-external';
export const AI_AUDIT_QUEUE_NAME = 'pim-ai-audit';
export const AI_AUDIT_JOB = 'audit-single';
export const PIM_EXTRACTION_QUEUE_NAME = 'pim-extraction';
export const PIM_EXTRACTION_JOB = 'extract-specs';

type SimilaritySearchQueue = ReturnType<typeof createQueue>;
type AIAuditQueue = ReturnType<typeof createQueue>;
type ExtractionQueue = ReturnType<typeof createQueue>;

let similaritySearchQueue: SimilaritySearchQueue | undefined;
let aiAuditQueue: AIAuditQueue | undefined;
let extractionQueue: ExtractionQueue | undefined;

function getSimilaritySearchQueue(): SimilaritySearchQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  similaritySearchQueue ??= createQueue(qmOptions, {
    name: SIMILARITY_SEARCH_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
    },
  });
  return similaritySearchQueue;
}

function getAIAuditQueue(): AIAuditQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  aiAuditQueue ??= createQueue(qmOptions, {
    name: AI_AUDIT_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
    },
  });
  return aiAuditQueue;
}

function getExtractionQueue(): ExtractionQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  extractionQueue ??= createQueue(qmOptions, {
    name: PIM_EXTRACTION_QUEUE_NAME,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
    },
  });
  return extractionQueue;
}

export async function enqueueSimilaritySearchJob(params: {
  shopId: string;
  productId: string;
  priority?: number;
}) {
  const queue = getSimilaritySearchQueue();
  const { priority, ...payload } = params;
  const job = await queue.add(SIMILARITY_SEARCH_JOB, payload, {
    ...(priority ? { priority } : {}),
  });
  return job.id;
}

export async function enqueueAIAuditJob(params: { shopId: string; matchId: string }) {
  const queue = getAIAuditQueue();
  const job = await queue.add(AI_AUDIT_JOB, params, {
    jobId: `ai-audit:${params.matchId}`,
  });
  return job.id;
}

export async function enqueueExtractionJob(params: { shopId: string; matchId: string }) {
  const queue = getExtractionQueue();
  const job = await queue.add(PIM_EXTRACTION_JOB, params, {
    jobId: `pim-extract:${params.matchId}`,
  });
  return job.id;
}

export async function closeSimilarityQueues(): Promise<void> {
  if (similaritySearchQueue) {
    await similaritySearchQueue.close();
    similaritySearchQueue = undefined;
  }
  if (aiAuditQueue) {
    await aiAuditQueue.close();
    aiAuditQueue = undefined;
  }
  if (extractionQueue) {
    await extractionQueue.close();
    extractionQueue = undefined;
  }
}
