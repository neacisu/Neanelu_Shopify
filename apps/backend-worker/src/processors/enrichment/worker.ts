import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  ENRICHMENT_JOB_NAME,
  ENRICHMENT_QUEUE_NAME,
  configFromEnv,
  createWorker,
  type DlqQueueLike,
  type DlqEntry,
  withJobTelemetryContext,
} from '@app/queue-manager';
import type { EnrichmentJobPayload } from '@app/types';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';

export interface EnrichmentWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
  dlqQueue: DlqQueueLike | undefined;
}

export function startEnrichmentWorker(logger: Logger): EnrichmentWorkerHandle {
  const env = loadEnv();
  const { worker, dlqQueue } = createWorker(
    { config: configFromEnv(env) },
    {
      name: ENRICHMENT_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('enrichment-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== ENRICHMENT_JOB_NAME) {
              throw new Error(`unknown_enrichment_job:${job.name}`);
            }

            const payload = job.data as EnrichmentJobPayload;
            if (!payload?.shopId || !Array.isArray(payload.productIds)) {
              throw new Error('invalid_enrichment_payload');
            }

            // Stub implementation: real enrichment pipeline will be wired in F8.4.4.
            logger.info(
              { shopId: payload.shopId, count: payload.productIds.length },
              'Enrichment job received'
            );
            return;
          } finally {
            clearWorkerCurrentJob('enrichment-worker', jobId);
          }
        }),
      onDlqEntry: (entry: DlqEntry) => {
        logger.error({ entry }, 'Enrichment job moved to DLQ');
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
