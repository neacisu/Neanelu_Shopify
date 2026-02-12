import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createQueue,
  createWorker,
  ENRICHMENT_QUEUE_NAME,
  withJobTelemetryContext,
} from '@app/queue-manager';
import { recordPimQueuePaused } from '../../otel/metrics.js';

export const BUDGET_RESET_QUEUE_NAME = 'pim-budget-reset-queue';
export const BUDGET_RESET_JOB_NAME = 'pim.budget.daily-reset';

export interface BudgetResetWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

export async function runBudgetResetTick(params: {
  config: ReturnType<typeof configFromEnv>;
  logger: Logger;
}): Promise<boolean> {
  const enrichmentQueue = createQueue({ config: params.config }, { name: ENRICHMENT_QUEUE_NAME });
  try {
    const paused = await enrichmentQueue.isPaused();
    if (paused) {
      await enrichmentQueue.resume();
      // Balance the paused counter stream by emitting scheduler transition.
      recordPimQueuePaused('scheduler');
      params.logger.info({}, 'Enrichment queue resumed after daily budget reset');
      return true;
    }
    return false;
  } finally {
    await enrichmentQueue.close();
  }
}

export function startBudgetResetScheduler(logger: Logger): BudgetResetWorkerHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: BUDGET_RESET_QUEUE_NAME });

  void queue.add(
    BUDGET_RESET_JOB_NAME,
    {},
    {
      jobId: BUDGET_RESET_JOB_NAME,
      repeat: { pattern: '1 0 * * *', tz: 'UTC' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  const { worker } = createWorker(
    { config },
    {
      name: BUDGET_RESET_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(
          job,
          async () => await runBudgetResetTick({ config, logger })
        ),
    }
  );

  return {
    worker,
    queue,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
