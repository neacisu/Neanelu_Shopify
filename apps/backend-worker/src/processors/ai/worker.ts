import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  AI_BATCH_CLEANUP_JOB_NAME,
  AI_BATCH_ORCHESTRATOR_JOB_NAME,
  AI_BATCH_POLLER_JOB_NAME,
  AI_BATCH_QUEUE_NAME,
  configFromEnv,
  createWorker,
  type DlqQueueLike,
  type DlqEntry,
  withJobTelemetryContext,
} from '@app/queue-manager';
import {
  type AiBatchCleanupJobPayload,
  type AiBatchOrchestratorJobPayload,
  type AiBatchPollerJobPayload,
  validateAiBatchCleanupJobPayload,
  validateAiBatchOrchestratorJobPayload,
  validateAiBatchPollerJobPayload,
} from '@app/types';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { runAiBatchCleanup, runAiBatchOrchestrator, runAiBatchPoller } from './batch.js';

export interface AiBatchWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
  dlqQueue: DlqQueueLike | undefined;
}

export function startAiBatchWorker(logger: Logger): AiBatchWorkerHandle {
  const env = loadEnv();
  const { worker, dlqQueue } = createWorker(
    { config: configFromEnv(env) },
    {
      name: AI_BATCH_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('ai-batch-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name === AI_BATCH_ORCHESTRATOR_JOB_NAME) {
              const payload = job.data as AiBatchOrchestratorJobPayload;
              if (!validateAiBatchOrchestratorJobPayload(payload)) {
                throw new Error('invalid_ai_batch_orchestrator_payload');
              }
              await runAiBatchOrchestrator({ payload, logger });
              return;
            }

            if (job.name === AI_BATCH_POLLER_JOB_NAME) {
              const payload = job.data as AiBatchPollerJobPayload;
              if (!validateAiBatchPollerJobPayload(payload)) {
                throw new Error('invalid_ai_batch_poller_payload');
              }
              await runAiBatchPoller({ payload, logger });
              return;
            }

            if (job.name === AI_BATCH_CLEANUP_JOB_NAME) {
              const payload = job.data as AiBatchCleanupJobPayload;
              if (!validateAiBatchCleanupJobPayload(payload)) {
                throw new Error('invalid_ai_batch_cleanup_payload');
              }
              const retentionDays = payload.retentionDays ?? env.openAiBatchRetentionDays;
              await runAiBatchCleanup({ shopId: payload.shopId, retentionDays, logger });
              return;
            }

            throw new Error(`unknown_ai_batch_job:${job.name}`);
          } finally {
            clearWorkerCurrentJob('ai-batch-worker', jobId);
          }
        }),
      onDlqEntry: (entry: DlqEntry) => {
        logger.error({ entry }, 'AI batch job moved to DLQ');
      },
    }
  );

  return {
    worker,
    dlqQueue,
    close: async () => {
      await worker.close();
      if (dlqQueue && 'close' in dlqQueue) {
        await (dlqQueue as { close: () => Promise<void> }).close();
      }
    },
  };
}
