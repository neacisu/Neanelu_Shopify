import { withTenantContext } from '@app/database';

export async function createLexJobRunRecord(params: {
  shopId: string;
  queueName: string;
  jobId: string;
  jobName: string;
  groupId: string;
  payload: unknown;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO job_runs
         (shop_id, queue_name, job_id, job_name, group_id, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, 'waiting', $6::jsonb, now())
       ON CONFLICT DO NOTHING`,
      [
        params.shopId,
        params.queueName,
        params.jobId,
        params.jobName,
        params.groupId,
        JSON.stringify(params.payload),
      ]
    );
  });
}

async function updateLexJobRunStatus(params: {
  shopId: string;
  queueName: string;
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'retrying';
  startedAt?: boolean;
  completedAt?: boolean;
  failedAt?: boolean;
  attemptsIncrement?: boolean;
  errorMessage?: string | null;
  errorStack?: string | null;
  result?: unknown;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE job_runs
       SET status = $4,
           started_at = CASE WHEN $5 THEN COALESCE(started_at, now()) ELSE started_at END,
           completed_at = CASE WHEN $6 THEN now() ELSE completed_at END,
           failed_at = CASE WHEN $7 THEN now() ELSE failed_at END,
           attempts = CASE WHEN $8 THEN COALESCE(attempts, 0) + 1 ELSE attempts END,
           error_message = COALESCE($9, error_message),
           error_stack = COALESCE($10, error_stack),
           result = COALESCE($11::jsonb, result)
       WHERE shop_id = $1
         AND queue_name = $2
         AND job_id = $3`,
      [
        params.shopId,
        params.queueName,
        params.jobId,
        params.status,
        params.startedAt === true,
        params.completedAt === true,
        params.failedAt === true,
        params.attemptsIncrement === true,
        params.errorMessage ?? null,
        params.errorStack ?? null,
        params.result === undefined ? null : JSON.stringify(params.result),
      ]
    );
  });
}

export async function markLexJobRunActive(params: {
  shopId: string;
  queueName: string;
  jobId: string;
}): Promise<void> {
  await updateLexJobRunStatus({ ...params, status: 'active', startedAt: true });
}

export async function markLexJobRunCompleted(params: {
  shopId: string;
  queueName: string;
  jobId: string;
  result?: unknown;
}): Promise<void> {
  await updateLexJobRunStatus({
    ...params,
    status: 'completed',
    completedAt: true,
  });
}

export async function markLexJobRunFailed(params: {
  shopId: string;
  queueName: string;
  jobId: string;
  errorMessage: string;
  errorStack?: string | null;
}): Promise<void> {
  await updateLexJobRunStatus({
    ...params,
    status: 'failed',
    failedAt: true,
  });
}

export async function markLexJobRunRetrying(params: {
  shopId: string;
  queueName: string;
  jobId: string;
  errorMessage?: string | null;
}): Promise<void> {
  await updateLexJobRunStatus({
    ...params,
    status: 'retrying',
    attemptsIncrement: true,
  });
}

export async function markLexJobRunDelayed(params: {
  shopId: string;
  queueName: string;
  jobId: string;
}): Promise<void> {
  await updateLexJobRunStatus({
    ...params,
    status: 'delayed',
  });
}
