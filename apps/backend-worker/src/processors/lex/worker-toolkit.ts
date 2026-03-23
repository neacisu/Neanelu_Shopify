import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createWorker,
  type DlqEntry,
  type DlqQueueLike,
  withJobTelemetryContext,
} from '@app/queue-manager';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { refreshLexMetrics } from '../../services/lex-ops.js';
import {
  markLexJobRunActive,
  markLexJobRunCompleted,
  markLexJobRunFailed,
  markLexJobRunRetrying,
} from './job-runs.js';

export interface LexWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
  dlqQueue: DlqQueueLike | undefined;
}

function getShopIdFromJobData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const shopId = (data as { shopId?: unknown }).shopId;
  return typeof shopId === 'string' && shopId.trim() ? shopId : null;
}

export function createLexWorker(params: {
  logger: Logger;
  queueName: string;
  workerId: string;
  processor: (job: {
    id?: string | number | null;
    name: string;
    data: unknown;
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<unknown>;
}): LexWorkerHandle {
  const env = loadEnv();
  const concurrencyRaw = Number(process.env['LEX_WORKER_CONCURRENCY']);
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw > 0
      ? Math.min(32, Math.floor(concurrencyRaw))
      : 4;

  const { worker, dlqQueue } = createWorker(
    { config: configFromEnv(env) },
    {
      name: params.queueName,
      enableDlq: true,
      enableDelayHandling: true,
      stalledInterval: 600_000,
      workerOptions: {
        concurrency,
        group: { concurrency: 1 },
        lockDuration: 300_000,
      },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          const shopId = getShopIdFromJobData(job.data);

          setWorkerCurrentJob(params.workerId, {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (shopId) {
              await markLexJobRunActive({
                shopId,
                queueName: params.queueName,
                jobId,
              }).catch(() => undefined);
            }

            const result = await params.processor(job);

            if (shopId) {
              await markLexJobRunCompleted({
                shopId,
                queueName: params.queueName,
                jobId,
                result,
              }).catch(() => undefined);
            }

            return result;
          } catch (error) {
            if (shopId) {
              const maxAttempts =
                typeof job.opts.attempts === 'number' && job.opts.attempts > 0
                  ? job.opts.attempts
                  : 1;
              const currentAttempt = (job.attemptsMade ?? 0) + 1;
              if (currentAttempt < maxAttempts) {
                await markLexJobRunRetrying({
                  shopId,
                  queueName: params.queueName,
                  jobId,
                  errorMessage: error instanceof Error ? error.message : String(error),
                }).catch(() => undefined);
              } else {
                await markLexJobRunFailed({
                  shopId,
                  queueName: params.queueName,
                  jobId,
                  errorMessage: error instanceof Error ? error.message : String(error),
                  errorStack: error instanceof Error ? (error.stack ?? null) : null,
                }).catch(() => undefined);
              }
            }
            throw error;
          } finally {
            clearWorkerCurrentJob(params.workerId, jobId);
            if (shopId) {
              void refreshLexMetrics({ shopId, env }).catch(() => undefined);
            }
          }
        }),
      onDlqEntry: (entry: DlqEntry) => {
        params.logger.error({ entry, queueName: params.queueName }, 'Lexical job moved to DLQ');
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
