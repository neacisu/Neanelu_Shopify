/**
 * Token Health Queue
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Periodic job for token health checks
 * - BullMQ Pro (aligned with queue-manager)
 */

import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

import {
  TOKEN_HEALTH_JOB_NAME,
  TOKEN_HEALTH_REPEAT_OPTIONS,
} from '../auth/jobs/token-health-job.js';

const env = loadEnv();

export const TOKEN_HEALTH_QUEUE_NAME = 'token-health';

type TokenHealthQueue = ReturnType<typeof createQueue>;
let tokenHealthQueue: TokenHealthQueue | undefined;

function getQueue(): TokenHealthQueue {
  const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(env) };
  tokenHealthQueue ??= createQueue(qmOptions, {
    name: TOKEN_HEALTH_QUEUE_NAME,
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
