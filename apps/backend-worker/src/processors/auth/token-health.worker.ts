/**
 * Token Health Worker
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Runs periodic token health check batches
 */

import { Worker } from 'bullmq';
import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';

import {
  processTokenHealthBatch,
  createTokenHealthJobConfig,
  TOKEN_HEALTH_JOB_NAME,
  type TokenHealthJobData,
} from '../../auth/jobs/token-health-job.js';

import { TOKEN_HEALTH_QUEUE_NAME } from '../../queue/token-health-queue.js';

const env = loadEnv();

export interface TokenHealthWorkerHandle {
  worker: Worker<TokenHealthJobData>;
  close: () => Promise<void>;
}

async function closeWithTimeout(label: string, fn: () => Promise<void>, timeoutMs: number) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs).unref();
  });
  await Promise.race([fn(), timeout]);
}

function startTokenHealthWorker(logger: Logger): TokenHealthWorkerHandle {
  const worker = new Worker<TokenHealthJobData>(
    TOKEN_HEALTH_QUEUE_NAME,
    async (job) => {
      if (job.name !== TOKEN_HEALTH_JOB_NAME) return;

      const config = createTokenHealthJobConfig(env.encryptionKeyHex);
      await processTokenHealthBatch(config, logger);
    },
    {
      connection: { url: env.redisUrl },
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, name: job?.name, err }, 'Token health job failed');
  });

  const close = async (): Promise<void> => {
    await closeWithTimeout(
      'token-health worker shutdown',
      async () => {
        const pause = (
          worker as unknown as { pause?: (doNotWaitActive?: boolean) => Promise<void> }
        ).pause;
        if (typeof pause === 'function') {
          await pause.call(worker, false).catch(() => {
            // best-effort
          });
        }

        await worker.close();
      },
      10_000
    );
  };

  return { worker, close };
}

export { startTokenHealthWorker };
