/**
 * Token Health Queue
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Periodic job for token health checks
 * - BullMQ OSS (no Pro features yet)
 */

import { Queue } from 'bullmq';
import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';

import {
  TOKEN_HEALTH_JOB_NAME,
  TOKEN_HEALTH_REPEAT_OPTIONS,
  type TokenHealthJobData,
} from '../auth/jobs/token-health-job.js';

const env = loadEnv();

export const TOKEN_HEALTH_QUEUE_NAME = 'token-health';

let tokenHealthQueue: Queue<TokenHealthJobData> | undefined;

function getQueue(): Queue<TokenHealthJobData> {
  tokenHealthQueue ??= new Queue<TokenHealthJobData>(TOKEN_HEALTH_QUEUE_NAME, {
    connection: {
      url: env.redisUrl,
    },
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 200,
      attempts: 1,
    },
  });

  return tokenHealthQueue;
}

export async function scheduleTokenHealthJob(logger: Logger): Promise<void> {
  const queue = getQueue();

  await queue.add(
    TOKEN_HEALTH_JOB_NAME,
    {
      triggeredBy: 'scheduler',
      timestamp: Date.now(),
    },
    {
      jobId: 'token-health-check:repeat',
      repeat: TOKEN_HEALTH_REPEAT_OPTIONS,
    }
  );

  logger.info({ queue: TOKEN_HEALTH_QUEUE_NAME }, 'Token health check job scheduled');
}

export async function closeTokenHealthQueue(): Promise<void> {
  if (tokenHealthQueue) {
    await tokenHealthQueue.close();
    tokenHealthQueue = undefined;
  }
}
