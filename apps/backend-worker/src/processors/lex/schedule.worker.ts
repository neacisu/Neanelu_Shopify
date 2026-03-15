import { CronExpressionParser } from 'cron-parser';

import type { Logger } from '@app/logger';
import { pool, withTenantContext } from '@app/database';

import {
  enqueueLexPublishJob,
  enqueueLexRetentionJob,
  enqueueLexRunRequestedJob,
} from '../../queue/lex-queues.js';

export interface LexScheduleWorkerHandle {
  worker: { isRunning?: () => boolean };
  close: () => Promise<void>;
  isRunning: () => boolean;
}

type ScheduledTaskRow = Readonly<{
  id: string;
  shopId: string;
  taskName: string;
  cronExpression: string;
  jobData: Record<string, unknown> | null;
  nextRunAt: Date | null;
}>;

function parseEntityTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return ['product', 'variant', 'collection'];
  const values = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return values.length > 0 ? values : ['product', 'variant', 'collection'];
}

function deriveSourceTables(extractScope: Record<string, unknown>): string[] {
  const entityTypes = parseEntityTypes(extractScope['entityTypes']);
  const map = new Map<string, string>([
    ['product', 'shopify_products'],
    ['variant', 'shopify_variants'],
    ['collection', 'shopify_collections'],
    ['master_product', 'prod_master'],
  ]);

  return entityTypes
    .map((entityType) => map.get(entityType))
    .filter((value): value is string => typeof value === 'string');
}

function safeNextRun(cronExpression: string, baseDate: Date): Date | null {
  try {
    const iter = CronExpressionParser.parse(cronExpression, {
      tz: 'UTC',
      currentDate: baseDate,
    });
    return iter.next().toDate();
  } catch {
    return null;
  }
}

async function dispatchLexScheduledTask(params: {
  row: ScheduledTaskRow;
  logger: Logger;
}): Promise<void> {
  const triggeredAt = Date.now();
  const runType =
    params.row.jobData?.['runType'] === 'full_rebuild' ||
    params.row.jobData?.['runType'] === 'delta_rebuild' ||
    params.row.jobData?.['runType'] === 'context_rebuild' ||
    params.row.jobData?.['runType'] === 'translate_only' ||
    params.row.jobData?.['runType'] === 'publish_only'
      ? params.row.jobData['runType']
      : null;

  if (params.row.taskName === 'lex.publish.retry') {
    await enqueueLexPublishJob({
      shopId: params.row.shopId,
      requestedAt: triggeredAt,
      retryOnly: true,
    });
    return;
  }

  if (params.row.taskName === 'lex.retention.compact') {
    await enqueueLexRetentionJob({
      shopId: params.row.shopId,
      requestedAt: triggeredAt,
    });
    return;
  }

  if (runType) {
    const runRow = await withTenantContext(params.row.shopId, async (client) => {
      const active = await client.query<{ id: string }>(
        `SELECT id
         FROM lex_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running', 'paused')
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.row.shopId]
      );
      if (active.rows[0]?.id) {
        return { activeRunId: active.rows[0].id, runId: null };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO lex_runs
           (shop_id, run_type, source_scope, current_phase, status, metadata, created_at, updated_at)
         VALUES
           ($1, $2, $3::jsonb, 'extract.fragments', 'pending', '{"requested_via":"scheduler"}'::jsonb, now(), now())
         RETURNING id`,
        [
          params.row.shopId,
          runType,
          JSON.stringify(
            (params.row.jobData?.['extractScope'] &&
            typeof params.row.jobData['extractScope'] === 'object' &&
            !Array.isArray(params.row.jobData['extractScope'])
              ? params.row.jobData['extractScope']
              : {}) as Record<string, unknown>
          ),
        ]
      );

      const runId = inserted.rows[0]?.id ?? null;
      if (!runId) {
        return { activeRunId: null, runId: null };
      }

      const extractScope =
        (params.row.jobData?.['extractScope'] &&
        typeof params.row.jobData['extractScope'] === 'object' &&
        !Array.isArray(params.row.jobData['extractScope'])
          ? (params.row.jobData['extractScope'] as Record<string, unknown>)
          : {}) ?? {};
      const sourceTables = deriveSourceTables(extractScope);

      for (const sourceTable of sourceTables) {
        await client.query(
          `INSERT INTO lex_run_shards
             (run_id, shop_id, shard_key, phase_name, source_table, status, metadata, created_at)
           VALUES
             ($1, $2, $3, 'extract.fragments', $4, 'pending', $5::jsonb, now())`,
          [
            runId,
            params.row.shopId,
            `${sourceTable}:all`,
            sourceTable,
            JSON.stringify({
              sourceTable,
              scheduledTaskId: params.row.id,
            }),
          ]
        );
      }

      return { activeRunId: null, runId };
    });

    if (runRow.activeRunId || !runRow.runId) {
      return;
    }

    await enqueueLexRunRequestedJob({
      shopId: params.row.shopId,
      runId: runRow.runId,
      runType,
      triggeredBy: 'scheduler',
      requestedAt: triggeredAt,
      sourceScope: {},
    });
  }
}

export async function runLexScheduleTick(logger: Logger): Promise<void> {
  const now = new Date();
  const dueTasks = await pool.query<ScheduledTaskRow>(
    `SELECT
       id,
       shop_id AS "shopId",
       task_name AS "taskName",
       cron_expression AS "cronExpression",
       job_data AS "jobData",
       next_run_at AS "nextRunAt"
     FROM scheduled_tasks
     WHERE is_active = true
       AND task_name IN ('lex.delta.rebuild', 'lex.publish.retry', 'lex.retention.compact')
       AND (next_run_at IS NULL OR next_run_at <= $1)
     ORDER BY next_run_at NULLS FIRST`,
    [now.toISOString()]
  );

  for (const row of dueTasks.rows) {
    await dispatchLexScheduledTask({ row, logger });
    const nextRun = safeNextRun(row.cronExpression, now);

    await withTenantContext(row.shopId, async (client) => {
      await client.query(
        `UPDATE scheduled_tasks
         SET last_run_at = $2,
             next_run_at = $3,
             run_count = COALESCE(run_count, 0) + 1,
             updated_at = now()
         WHERE shop_id = $1
           AND id = $4`,
        [row.shopId, now.toISOString(), nextRun?.toISOString() ?? null, row.id]
      );
    });
  }
}

export function startLexScheduleWorker(logger: Logger): LexScheduleWorkerHandle {
  const tickSeconds = Number(process.env['LEX_SCHEDULE_TICK_SECONDS'] ?? 30);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 1 ? tickSeconds * 1000 : 30_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runLexScheduleTick(logger);
    } catch (error) {
      logger.error({ error }, 'Lexical schedule tick failed');
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), tickMs);
  void tick();

  return {
    worker: {
      isRunning: () => !closed,
    },
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.resolve();
    },
    isRunning: () => !closed,
  };
}
