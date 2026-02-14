import type { Logger } from '@app/logger';
import { pool } from '@app/database';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createQueue,
  createWorker,
  withJobTelemetryContext,
} from '@app/queue-manager';

export const RAW_HARVEST_RETENTION_QUEUE_NAME = 'pim-raw-harvest-retention-queue';
export const RAW_HARVEST_RETENTION_JOB_NAME = 'pim.raw-harvest.retention';

export interface RawHarvestRetentionSchedulerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

export async function runRawHarvestRetentionTick(logger: Logger): Promise<{ deleted: number }> {
  const result = await pool.query<{ count: string }>(
    `WITH rows AS (
       DELETE FROM prod_raw_harvest
        WHERE (ttl_expires_at IS NOT NULL AND ttl_expires_at < now())
           OR (created_at < now() - interval '90 days')
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM rows`
  );
  const deleted = Number(result.rows[0]?.count ?? 0);
  logger.info({ deleted }, 'Raw harvest retention cleanup completed');
  return { deleted };
}

export function startRawHarvestRetentionScheduler(
  logger: Logger
): RawHarvestRetentionSchedulerHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: RAW_HARVEST_RETENTION_QUEUE_NAME });

  void queue.add(
    RAW_HARVEST_RETENTION_JOB_NAME,
    {},
    {
      jobId: RAW_HARVEST_RETENTION_JOB_NAME,
      repeat: { pattern: '15 2 * * *', tz: 'UTC' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  const { worker } = createWorker(
    { config },
    {
      name: RAW_HARVEST_RETENTION_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => await runRawHarvestRetentionTick(logger)),
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
