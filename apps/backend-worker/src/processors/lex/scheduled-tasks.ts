import { CronExpressionParser } from 'cron-parser';

import { pool, withTenantContext } from '@app/database';

const LEX_SCHEDULED_TASK_SPECS = [
  {
    taskName: 'lex.delta.rebuild',
    cronExpression: '*/30 * * * *',
    queueName: 'lex.extract.fragments',
    jobData: { runType: 'delta_rebuild', triggeredBy: 'scheduler' },
  },
  {
    taskName: 'lex.publish.retry',
    cronExpression: '*/10 * * * *',
    queueName: 'lex.publish',
    jobData: { retryOnly: true, triggeredBy: 'scheduler' },
  },
  {
    taskName: 'lex.retention.compact',
    cronExpression: '0 2 * * *',
    queueName: 'lex.retention.compact',
    jobData: { triggeredBy: 'scheduler' },
  },
] as const;

function nextRunAt(cronExpression: string, baseDate: Date): Date | null {
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

export async function reconcileLexScheduledTasks(params: {
  shopId: string;
  enabled: boolean;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    const now = new Date();

    for (const spec of LEX_SCHEDULED_TASK_SPECS) {
      const nextRun = params.enabled ? nextRunAt(spec.cronExpression, now) : null;

      await client.query(
        `INSERT INTO scheduled_tasks
           (shop_id, task_name, cron_expression, queue_name, job_data, is_active, next_run_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
         ON CONFLICT (shop_id, task_name)
         DO UPDATE
            SET cron_expression = EXCLUDED.cron_expression,
                queue_name = EXCLUDED.queue_name,
                job_data = EXCLUDED.job_data,
                is_active = EXCLUDED.is_active,
                next_run_at = EXCLUDED.next_run_at,
                updated_at = now()`,
        [
          params.shopId,
          spec.taskName,
          spec.cronExpression,
          spec.queueName,
          JSON.stringify(spec.jobData),
          params.enabled,
          nextRun?.toISOString() ?? null,
        ]
      );
    }
  });
}

export async function listLexEnabledShops(): Promise<string[]> {
  const result = await pool.query<{ shopId: string }>(
    `SELECT shop_id AS "shopId"
     FROM lex_shop_settings
     WHERE enabled = true
     ORDER BY shop_id`
  );

  return result.rows.map((row) => row.shopId);
}
