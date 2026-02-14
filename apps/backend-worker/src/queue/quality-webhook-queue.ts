import type { AppEnv } from '@app/config';
import type { QualityWebhookJobData } from '@app/types';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createQueue,
  NEANELU_BACKOFF_STRATEGY,
  type CreateQueueManagerOptions,
} from '@app/queue-manager';

let cachedEnv: AppEnv | null = null;
function getEnv(): AppEnv {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export const QUALITY_WEBHOOK_QUEUE_NAME = 'pim-quality-webhook';
export const QUALITY_WEBHOOK_JOB_NAME = 'dispatch-quality-webhook';

type QualityWebhookQueue = ReturnType<typeof createQueue>;
let qualityWebhookQueue: QualityWebhookQueue | undefined;

function getQualityWebhookQueue(): QualityWebhookQueue {
  const configuredAttempts: unknown = getEnv().qualityWebhookMaxAttempts;
  const attempts =
    typeof configuredAttempts === 'number' &&
    Number.isFinite(configuredAttempts) &&
    configuredAttempts > 0
      ? Math.floor(configuredAttempts)
      : 3;
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(getEnv()) };
  qualityWebhookQueue ??= createQueue(qmOptions, {
    name: QUALITY_WEBHOOK_QUEUE_NAME,
    defaultJobOptions: {
      attempts,
      backoff: { type: NEANELU_BACKOFF_STRATEGY, delay: 1000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });
  return qualityWebhookQueue;
}

export async function enqueueQualityWebhookJob(params: QualityWebhookJobData): Promise<string> {
  const queue = getQualityWebhookQueue();
  const job = await queue.add(QUALITY_WEBHOOK_JOB_NAME, params, {
    jobId: `qw:${params.eventId}`,
  });
  return String(job.id);
}

export async function enqueueQualityWebhookRetryJob(
  params: QualityWebhookJobData
): Promise<string> {
  const queue = getQualityWebhookQueue();
  const job = await queue.add(QUALITY_WEBHOOK_JOB_NAME, params, {
    jobId: `qw:${params.eventId}:retry:${Date.now()}`,
  });
  return String(job.id);
}

export async function closeQualityWebhookQueue(): Promise<void> {
  if (!qualityWebhookQueue) return;
  await qualityWebhookQueue.close();
  qualityWebhookQueue = undefined;
}
