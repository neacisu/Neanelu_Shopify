/**
 * Bulk Operations State Machine (minimal)
 *
 * PR-036 (F5.1.2): Persist and standardize lifecycle writes for bulk_runs/bulk_steps.
 *
 * This module intentionally does not implement polling/downloading/processing.
 */

import { withTenantContext } from '@app/database';
import { createHash } from 'node:crypto';

import { recordBulkError, recordDbQuery } from '../../otel/metrics.js';

export type BulkRunRow = Readonly<{
  id: string;
  shop_id: string;
  status: string;
  shopify_operation_id: string | null;
  idempotency_key: string | null;
}>;

export type BulkRunStatus =
  | 'pending'
  | 'running'
  | 'polling'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BulkRunContextRow = Readonly<{
  id: string;
  shop_id: string;
  status: string;
  operation_type: string;
  query_type: string | null;
  idempotency_key: string | null;
  max_retries: number | null;
  records_processed: number | null;
  bytes_processed: number | null;
  result_size_bytes: number | null;
  cursor_state: unknown;
  result_url: string | null;
  partial_data_url: string | null;
}>;

const BULK_RUN_STATUS_TRANSITIONS: Readonly<Record<BulkRunStatus, ReadonlySet<BulkRunStatus>>> = {
  pending: new Set(['pending', 'running', 'failed', 'cancelled']),
  running: new Set([
    'running',
    'polling',
    'downloading',
    'processing',
    'completed',
    'failed',
    'cancelled',
  ]),
  polling: new Set(['polling', 'downloading', 'processing', 'completed', 'failed', 'cancelled']),
  downloading: new Set(['downloading', 'processing', 'completed', 'failed', 'cancelled']),
  processing: new Set(['processing', 'completed', 'failed', 'cancelled']),
  completed: new Set(['completed']),
  failed: new Set(['failed']),
  cancelled: new Set(['cancelled']),
};

function isBulkRunStatus(value: string | null | undefined): value is BulkRunStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'polling' ||
    value === 'downloading' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

export function isValidBulkRunTransition(from: string, to: string): boolean {
  if (!isBulkRunStatus(from) || !isBulkRunStatus(to)) return false;
  return BULK_RUN_STATUS_TRANSITIONS[from].has(to);
}

export async function getBulkRunStatus(params: {
  shopId: string;
  bulkRunId: string;
}): Promise<BulkRunStatus | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ status: string }>(
      `SELECT status
       FROM bulk_runs
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
      [params.bulkRunId, params.shopId]
    );
    const status = res.rows[0]?.status ?? null;
    return isBulkRunStatus(status) ? status : null;
  });
}

export async function assertValidBulkRunTransition(params: {
  shopId: string;
  bulkRunId: string;
  nextStatus: BulkRunStatus;
}): Promise<void> {
  const current = await getBulkRunStatus({ shopId: params.shopId, bulkRunId: params.bulkRunId });
  if (!current) throw new Error('bulk_run_not_found');
  if (!isValidBulkRunTransition(current, params.nextStatus)) {
    throw new Error(`bulk_run_invalid_transition:${current}->${params.nextStatus}`);
  }
}

export async function loadBulkRunContext(params: {
  shopId: string;
  bulkRunId: string;
}): Promise<BulkRunContextRow | null> {
  const started = Date.now();
  try {
    return await withTenantContext(params.shopId, async (client) => {
      const res = await client.query<BulkRunContextRow>(
        `SELECT id,
                shop_id,
                status,
                operation_type,
                query_type,
                idempotency_key,
                max_retries,
                records_processed,
                bytes_processed,
          result_size_bytes,
                cursor_state,
                result_url,
                partial_data_url
         FROM bulk_runs
         WHERE id = $1
           AND shop_id = $2
         LIMIT 1`,
        [params.bulkRunId, params.shopId]
      );
      return res.rows[0] ?? null;
    });
  } finally {
    recordDbQuery('select', (Date.now() - started) / 1000);
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveIdempotencyKey(input: {
  shopId: string;
  operationType: string;
  queryType?: string | null;
  graphqlQueryHash: string;
}): string {
  return sha256Hex(
    `${input.shopId}|${input.operationType}|${input.queryType ?? ''}|${input.graphqlQueryHash}`
  );
}

export async function insertOrLoadBulkRun(params: {
  shopId: string;
  operationType: string;
  queryType: string | null;
  idempotencyKey: string;
  graphqlQueryHash: string;
}): Promise<BulkRunRow> {
  const started = Date.now();
  try {
    return await withTenantContext(params.shopId, async (client) => {
      // Idempotency-first: if the run already exists, resume it.
      // We cannot rely on the database enforcing uniqueness on idempotency_key.
      const existing = await client.query<BulkRunRow>(
        `SELECT id, shop_id, status, shopify_operation_id, idempotency_key
         FROM bulk_runs
         WHERE shop_id = $1
           AND idempotency_key = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.shopId, params.idempotencyKey]
      );
      if (existing.rows[0]) return existing.rows[0];

      const result = await client.query<BulkRunRow>(
        `INSERT INTO bulk_runs (
           shop_id,
           operation_type,
           query_type,
           status,
           idempotency_key,
           graphql_query_hash,
           retry_count,
           max_retries,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'pending', $4, $5, 0, 3, now(), now())
         RETURNING id, shop_id, status, shopify_operation_id, idempotency_key`,
        [
          params.shopId,
          params.operationType,
          params.queryType,
          params.idempotencyKey,
          params.graphqlQueryHash,
        ]
      );

      const row = result.rows[0];
      if (!row) throw new Error('bulk_run_insert_missing_row');
      return row;
    });
  } catch (err) {
    // Unique violations can happen for:
    // - idempotency_key unique constraint
    // - idx_bulk_runs_active_shop partial unique index
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes('duplicate key value')) throw err;

    return await withTenantContext(params.shopId, async (client) => {
      // Prefer idempotency lookup; this makes retries deterministic.
      const byIdempotency = await client.query<BulkRunRow>(
        `SELECT id, shop_id, status, shopify_operation_id, idempotency_key
         FROM bulk_runs
         WHERE idempotency_key = $1
         LIMIT 1`,
        [params.idempotencyKey]
      );
      if (byIdempotency.rows[0]) return byIdempotency.rows[0];

      // Fallback: active run for shop (should be at most 1 by DB constraint).
      const active = await client.query<BulkRunRow>(
        `SELECT id, shop_id, status, shopify_operation_id, idempotency_key
         FROM bulk_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running', 'polling', 'downloading', 'processing')
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.shopId]
      );
      const row = active.rows[0];
      if (!row) throw err;
      return row;
    });
  } finally {
    recordDbQuery('insert', (Date.now() - started) / 1000);
  }
}

export async function insertBulkStep(params: {
  shopId: string;
  bulkRunId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string | null;
}): Promise<void> {
  const started = Date.now();
  const isTerminal = params.status === 'completed' || params.status === 'failed';
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO bulk_steps (
         bulk_run_id,
         shop_id,
         step_name,
         step_order,
         status,
         started_at,
         completed_at,
         error_message,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, 0, $4, now(), CASE WHEN $5::boolean THEN now() ELSE NULL END, $6, now(), now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.stepName,
        params.status,
        isTerminal,
        params.errorMessage ?? null,
      ]
    );
  });
  recordDbQuery('insert', (Date.now() - started) / 1000);
}

export async function markBulkRunFailed(params: {
  shopId: string;
  bulkRunId: string;
  errorMessage: string;
  errorType: string;
  errorCode?: string | null;
}): Promise<void> {
  await assertValidBulkRunTransition({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    nextStatus: 'failed',
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'failed',
           error_message = $1,
           completed_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [params.errorMessage, params.bulkRunId]
    );
  });

  await insertBulkError({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    errorType: params.errorType,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage,
  });
}

export async function insertBulkError(params: {
  shopId: string;
  bulkRunId: string;
  errorType: string;
  errorCode?: string | null;
  errorMessage: string;
  payload?: unknown;
  lineNumber?: number | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO bulk_errors (
         bulk_run_id,
         shop_id,
         error_type,
         error_code,
         error_message,
         line_number,
         payload,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.errorType,
        params.errorCode ?? null,
        params.errorMessage,
        params.lineNumber ?? null,
        params.payload ?? null,
      ]
    );
  });

  recordBulkError({ errorType: params.errorType });

  // Plan F5.1.7: abort when row-level error rate exceeds threshold.
  // Only consider errors that have an associated line_number (i.e., per-row processing errors).
  if (params.lineNumber != null) {
    await abortBulkRunIfErrorRateExceeded({ shopId: params.shopId, bulkRunId: params.bulkRunId });
  }
}

const BULK_ERROR_RATE_THRESHOLD_DEFAULT = 0.1;

export async function abortBulkRunIfErrorRateExceeded(params: {
  shopId: string;
  bulkRunId: string;
  threshold?: number;
}): Promise<boolean> {
  const threshold =
    typeof params.threshold === 'number' && Number.isFinite(params.threshold)
      ? Math.max(0, params.threshold)
      : BULK_ERROR_RATE_THRESHOLD_DEFAULT;

  const snapshot = await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ total: number | null; error_count: number | null }>(
      `WITH totals AS (
         SELECT records_processed::int AS total
         FROM bulk_runs
         WHERE id = $1
         LIMIT 1
       ), errs AS (
         SELECT COUNT(*)::int AS error_count
         FROM bulk_errors
         WHERE bulk_run_id = $1
           AND shop_id = $2
           AND line_number IS NOT NULL
       )
       SELECT totals.total, errs.error_count
       FROM totals, errs`,
      [params.bulkRunId, params.shopId]
    );
    return res.rows[0] ?? null;
  });

  const totalCount = snapshot?.total ?? null;
  const errorCount = snapshot?.error_count ?? null;
  if (!totalCount || totalCount <= 0) return false;
  if (!errorCount || errorCount <= 0) return false;

  if (errorCount / totalCount < threshold) return false;

  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'failed',
           error_message = COALESCE(error_message, 'error_rate_threshold_exceeded'),
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE id = $1
         AND status IS DISTINCT FROM 'failed'`,
      [params.bulkRunId]
    );
  });

  await insertBulkStep({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    stepName: 'error_rate_abort',
    status: 'failed',
    errorMessage: `Error rate threshold exceeded (${errorCount}/${totalCount} >= ${threshold})`,
  });

  await insertBulkError({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    errorType: 'error_rate_abort',
    errorCode: 'ERROR_RATE_THRESHOLD',
    errorMessage: `Error rate threshold exceeded (${errorCount}/${totalCount} >= ${threshold})`,
  });

  return true;
}

export async function markBulkRunStarted(params: {
  shopId: string;
  bulkRunId: string;
  shopifyOperationId: string;
  apiVersion: string;
  costEstimate: number | null;
}): Promise<void> {
  const started = Date.now();
  await assertValidBulkRunTransition({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    nextStatus: 'running',
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           shopify_operation_id = $1,
           api_version = $2,
           cost_estimate = COALESCE($3, cost_estimate),
           updated_at = now()
       WHERE id = $4`,
      [params.shopifyOperationId, params.apiVersion, params.costEstimate, params.bulkRunId]
    );
  });
  recordDbQuery('update', (Date.now() - started) / 1000);
}

export async function markBulkRunInProgress(params: {
  shopId: string;
  bulkRunId: string;
  status: Exclude<BulkRunStatus, 'pending' | 'completed' | 'failed' | 'cancelled'>;
}): Promise<void> {
  const started = Date.now();
  await assertValidBulkRunTransition({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    nextStatus: params.status,
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = $1,
           updated_at = now()
       WHERE id = $2`,
      [params.status, params.bulkRunId]
    );
  });
  recordDbQuery('update', (Date.now() - started) / 1000);
}

export async function markBulkRunCompleted(params: {
  shopId: string;
  bulkRunId: string;
  completedAt?: Date | null;
}): Promise<void> {
  const started = Date.now();
  await assertValidBulkRunTransition({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    nextStatus: 'completed',
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'completed',
           completed_at = COALESCE($1::timestamptz, completed_at, now()),
           updated_at = now()
       WHERE id = $2`,
      [params.completedAt ? params.completedAt.toISOString() : null, params.bulkRunId]
    );
  });
  recordDbQuery('update', (Date.now() - started) / 1000);
}

export async function patchBulkRunCursorState(params: {
  shopId: string;
  bulkRunId: string;
  patch: Record<string, unknown>;
}): Promise<void> {
  const started = Date.now();
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET cursor_state = COALESCE(cursor_state, '{}'::jsonb) || $1::jsonb,
           updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(params.patch), params.bulkRunId]
    );
  });
  recordDbQuery('update', (Date.now() - started) / 1000);
}
