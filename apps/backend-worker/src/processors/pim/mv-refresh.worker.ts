import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { MV_REFRESH_SCHEDULE } from '@app/pim';
import {
  configFromEnv,
  createQueue,
  createWorker,
  withJobTelemetryContext,
} from '@app/queue-manager';

export const MV_REFRESH_QUEUE_NAME = 'pim-mv-refresh-queue';
export const MV_REFRESH_HOURLY_JOB = 'pim.mv.refresh-hourly';
export const MV_REFRESH_DAILY_JOB = 'pim.mv.refresh-daily';

export interface MvRefreshWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

type MvRefreshJobPayload = Readonly<{
  type: 'hourly' | 'daily';
}>;

function toCronPattern(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error('Invalid cron pattern in MV_REFRESH_SCHEDULE');
}

export async function runMvRefreshTick(params: {
  type: MvRefreshJobPayload['type'];
  logger: Logger;
}): Promise<'refresh_mv_hourly' | 'refresh_mv_daily'> {
  const fnName = params.type === 'daily' ? 'refresh_mv_daily' : 'refresh_mv_hourly';
  await pool.query(`SELECT ${fnName}()`);
  params.logger.info({ fnName }, 'Materialized views refresh completed');
  return fnName;
}

export function startMvRefreshScheduler(logger: Logger): MvRefreshWorkerHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: MV_REFRESH_QUEUE_NAME });

  void queue.add(MV_REFRESH_HOURLY_JOB, { type: 'hourly' } satisfies MvRefreshJobPayload, {
    jobId: MV_REFRESH_HOURLY_JOB,
    repeat: { pattern: toCronPattern(MV_REFRESH_SCHEDULE.mv_pim_quality_progress), tz: 'UTC' },
    removeOnComplete: { count: 24 },
    removeOnFail: { count: 48 },
  });

  void queue.add(MV_REFRESH_DAILY_JOB, { type: 'daily' } satisfies MvRefreshJobPayload, {
    jobId: MV_REFRESH_DAILY_JOB,
    repeat: { pattern: toCronPattern(MV_REFRESH_SCHEDULE.mv_pim_source_performance), tz: 'UTC' },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
  });

  const { worker } = createWorker<MvRefreshJobPayload>(
    { config },
    {
      name: MV_REFRESH_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(
          job,
          async () =>
            await runMvRefreshTick({
              type: job.data?.type === 'daily' ? 'daily' : 'hourly',
              logger,
            })
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
