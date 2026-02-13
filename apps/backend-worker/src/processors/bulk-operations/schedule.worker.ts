import { CronExpressionParser } from 'cron-parser';
import type { Logger } from '@app/logger';
import { pool, withTenantContext } from '@app/database';
import { startBulkQueryFromContract } from './orchestrator.js';

export interface BulkScheduleWorkerHandle {
  close: () => Promise<void>;
}

type ScheduleRow = Readonly<{
  id: string;
  cron: string;
  timezone: string;
  next_run_at: Date | null;
}>;

function safeParseCron(params: { cron: string; timezone: string; baseDate: Date }): Date | null {
  try {
    const iter = CronExpressionParser.parse(params.cron, {
      tz: params.timezone,
      currentDate: params.baseDate,
    });
    return iter.next().toDate();
  } catch {
    return null;
  }
}

export async function runBulkScheduleTick(logger: Logger): Promise<void> {
  const shops = await pool.query<{ id: string }>(`SELECT id FROM shops`);
  const now = new Date();

  for (const shop of shops.rows) {
    await withTenantContext(shop.id, async (client) => {
      const res = await client.query<ScheduleRow>(
        `SELECT id, cron, timezone, next_run_at
         FROM bulk_schedules
         WHERE enabled = true
           AND (next_run_at IS NULL OR next_run_at <= $1)
         ORDER BY next_run_at NULLS FIRST
         FOR UPDATE SKIP LOCKED`,
        [now]
      );

      for (const row of res.rows) {
        const nextRun = safeParseCron({
          cron: row.cron,
          timezone: row.timezone,
          baseDate: now,
        });

        if (!nextRun) {
          logger.warn(
            { shopId: shop.id, scheduleId: row.id, cron: row.cron },
            'Bulk schedule skipped due to invalid cron'
          );
          continue;
        }

        await startBulkQueryFromContract(shop.id, {
          operationType: 'PRODUCTS_EXPORT',
          querySet: 'core',
          version: 'v2',
          idempotencyKey: `schedule:${row.id}:${now.toISOString()}`,
          triggeredBy: 'scheduler',
        });

        await client.query(
          `UPDATE bulk_schedules
           SET last_run_at = $1,
               next_run_at = $2,
               updated_at = now()
           WHERE id = $3`,
          [now.toISOString(), nextRun.toISOString(), row.id]
        );
      }
    });
  }
}

export function startBulkScheduleWorker(logger: Logger): BulkScheduleWorkerHandle {
  const tickSeconds = Number(process.env['BULK_SCHEDULE_TICK_SECONDS'] ?? 30);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 1 ? tickSeconds * 1000 : 30_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;

    try {
      await runBulkScheduleTick(logger);
    } catch (err) {
      logger.error({ err }, 'Bulk schedule tick failed');
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), tickMs);
  void tick();

  return {
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.resolve();
    },
  };
}
