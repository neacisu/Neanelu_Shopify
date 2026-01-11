/**
 * Bulk Operations State Machine (minimal)
 *
 * PR-036 (F5.1.2): Persist and standardize lifecycle writes for bulk_runs/bulk_steps.
 *
 * This module intentionally does not implement polling/downloading/processing.
 */

import { withTenantContext } from '@app/database';
import { createHash } from 'node:crypto';

import { recordDbQuery } from '../../otel/metrics.js';

export type BulkRunRow = Readonly<{
  id: string;
  shop_id: string;
  status: string;
  shopify_operation_id: string | null;
  idempotency_key: string | null;
}>;

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
           AND status IN ('pending', 'running')
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

    await client.query(
      `INSERT INTO bulk_errors (
         bulk_run_id,
         shop_id,
         error_type,
         error_code,
         error_message,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.errorType,
        params.errorCode ?? null,
        params.errorMessage,
      ]
    );
  });
}

export async function markBulkRunStarted(params: {
  shopId: string;
  bulkRunId: string;
  shopifyOperationId: string;
  apiVersion: string;
  costEstimate: number | null;
}): Promise<void> {
  const started = Date.now();
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
