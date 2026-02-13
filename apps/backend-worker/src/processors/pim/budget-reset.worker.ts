import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createQueue,
  createWorker,
  withJobTelemetryContext,
} from '@app/queue-manager';
import { resumeCostSensitiveQueues } from './cost-sensitive-queues.js';

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
  const results = await resumeCostSensitiveQueues({
    config: params.config,
    trigger: 'scheduler',
    logger: params.logger,
  });
  const resumedCount = results.filter((result) => result.changed).length;
  params.logger.info(
    { resumedCount, queueCount: results.length },
    'Cost-sensitive queues processed after daily budget reset'
  );
  return resumedCount > 0;
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
