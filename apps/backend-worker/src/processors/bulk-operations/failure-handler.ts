import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import type { BulkJobTriggeredBy, BulkOperationType } from '@app/types';

import {
  enqueueBulkOrchestratorJob,
  enqueueDlqEntry,
  type DlqEntry,
  type DlqQueueLike,
} from '@app/queue-manager';

import { getBulkQueryContract, type BulkQuerySet, type BulkQueryVersion } from './queries/index.js';
import { patchBulkRunCursorState } from './state-machine.js';

export type BulkTerminalStatus = 'FAILED' | 'CANCELED' | 'EXPIRED';

export type BulkFailureClass = 'transient' | 'permanent';

// Plan F5.1.7 error categories.
export type BulkFailureErrorType =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'INVALID_QUERY'
  | 'AUTH_FAILED'
  | 'SHOP_DELETED'
  | 'UNKNOWN';

export const BULK_MAX_RETRY_COUNT_DEFAULT = 3;
export const BULK_ERROR_RATE_THRESHOLD_DEFAULT = 0.1;

const BULK_RETRY_BACKOFF_BASE_MS = 30_000;
const BULK_RETRY_BACKOFF_MAX_MS = 30 * 60_000;

function bulkRetryBackoffMs(retryCount: number): number {
  // retryCount is 1-based after increment.
  const attempt = Number.isFinite(retryCount) ? Math.max(1, Math.trunc(retryCount)) : 1;
  const delay = BULK_RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(BULK_RETRY_BACKOFF_MAX_MS, Math.max(0, Math.trunc(delay)));
}

export function shouldAbortDueToErrorRate(params: {
  errorCount: number;
  totalCount: number;
  threshold?: number;
}): boolean {
  const threshold = params.threshold ?? BULK_ERROR_RATE_THRESHOLD_DEFAULT;
  const errorCount = Number.isFinite(params.errorCount) ? Math.max(0, params.errorCount) : 0;
  const totalCount = Number.isFinite(params.totalCount) ? Math.max(0, params.totalCount) : 0;
  if (totalCount <= 0) return false;
  return errorCount / totalCount >= threshold;
}

export type BulkFailureDecision = Readonly<{
  classification: BulkFailureClass;
  /** Plan-level error category (F5.1.7). */
  errorType: BulkFailureErrorType;
  /** App error code aligned with Docs/Error_Codes_Reference.md. */
  errorCode: string;
  /** Whether a restart should be attempted when retry budget allows. */
  shouldRetry: boolean;
}>;

export function classifyBulkTerminalFailure(input: {
  status: BulkTerminalStatus;
  shopifyErrorCode?: string | null;
}): BulkFailureDecision {
  const shopifyCode = input.shopifyErrorCode?.trim() ? input.shopifyErrorCode.trim() : null;

  if (input.status === 'CANCELED') {
    return {
      classification: 'permanent',
      errorType: 'UNKNOWN',
      errorCode: 'BULK_5006',
      shouldRetry: false,
    };
  }

  // Shopify-side error codes are not exhaustively documented; keep conservative defaults.
  if (shopifyCode) {
    // Transient failures (F5.1.7)
    if (shopifyCode.includes('THROTTLED') || shopifyCode.includes('RATE_LIMIT')) {
      return {
        classification: 'transient',
        errorType: 'RATE_LIMITED',
        errorCode: 'SHOP_3004',
        shouldRetry: true,
      };
    }
    if (shopifyCode.includes('TIMEOUT')) {
      return {
        classification: 'transient',
        errorType: 'TIMEOUT',
        errorCode: 'SHOP_3004',
        shouldRetry: true,
      };
    }

    // Permanent failures (F5.1.7)
    if (shopifyCode.includes('SHOP_NOT_FOUND') || shopifyCode.includes('SHOP_DELETED')) {
      return {
        classification: 'permanent',
        errorType: 'SHOP_DELETED',
        errorCode: 'SHOP_3004',
        shouldRetry: false,
      };
    }
    if (
      shopifyCode.includes('ACCESS_DENIED') ||
      shopifyCode.includes('UNAUTHORIZED') ||
      shopifyCode.includes('FORBIDDEN')
    ) {
      return {
        classification: 'permanent',
        errorType: 'AUTH_FAILED',
        errorCode: 'SHOP_3004',
        shouldRetry: false,
      };
    }
    if (shopifyCode.includes('INVALID') || shopifyCode.includes('INVALID_QUERY')) {
      return {
        classification: 'permanent',
        errorType: 'INVALID_QUERY',
        errorCode: 'SHOP_3004',
        shouldRetry: false,
      };
    }
  }

  // EXPIRED and FAILED are often retryable (Shopify flakiness, infra), but bounded.
  if (input.status === 'EXPIRED') {
    return {
      classification: 'transient',
      errorType: 'TIMEOUT',
      errorCode: 'SHOP_3004',
      shouldRetry: true,
    };
  }

  // FAILED default.
  return {
    classification: 'transient',
    errorType: 'NETWORK',
    errorCode: 'SHOP_3004',
    shouldRetry: true,
  };
}

type BulkRunRetryInfo = Readonly<{
  operationType: BulkOperationType;
  queryType: string | null;
  queryVersion: BulkQueryVersion | null;
  retryCount: number;
  maxRetries: number;
  idempotencyKey: string | null;
}>;

function coerceBulkQueryVersion(value: unknown): BulkQueryVersion | null {
  if (value === 'v1') return 'v1';
  if (value === 'v2') return 'v2';
  return null;
}

function coerceBulkQuerySet(value: unknown): BulkQuerySet | null {
  if (value === 'core' || value === 'meta' || value === 'inventory') return value;
  return null;
}

export async function loadBulkRunRetryInfo(
  shopId: string,
  bulkRunId: string
): Promise<BulkRunRetryInfo | null> {
  return await withTenantContext(shopId, async (client) => {
    const res = await client.query<{
      operation_type: string;
      query_type: string | null;
      retry_count: number | null;
      max_retries: number | null;
      idempotency_key: string | null;
      cursor_state: unknown;
    }>(
      `SELECT operation_type, query_type, retry_count, max_retries, idempotency_key, cursor_state
       FROM bulk_runs
       WHERE id = $1
       LIMIT 1`,
      [bulkRunId]
    );

    const row = res.rows[0];
    if (!row) return null;

    const cursor =
      row.cursor_state && typeof row.cursor_state === 'object'
        ? (row.cursor_state as Record<string, unknown>)
        : null;

    const contract =
      cursor && typeof cursor['bulkQueryContract'] === 'object'
        ? (cursor['bulkQueryContract'] as Record<string, unknown>)
        : null;

    const queryVersion = coerceBulkQueryVersion(contract?.['version']);

    return {
      operationType: row.operation_type as BulkOperationType,
      queryType: row.query_type ?? null,
      queryVersion,
      retryCount:
        typeof row.retry_count === 'number' && Number.isFinite(row.retry_count)
          ? row.retry_count
          : 0,
      maxRetries:
        typeof row.max_retries === 'number' && Number.isFinite(row.max_retries)
          ? row.max_retries
          : BULK_MAX_RETRY_COUNT_DEFAULT,
      idempotencyKey: row.idempotency_key ?? null,
    };
  });
}

export async function requestBulkRetry(params: {
  shopId: string;
  bulkRunId: string;
}): Promise<{ retryCount: number; maxRetries: number } | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ retry_count: number; max_retries: number }>(
      `UPDATE bulk_runs
       SET retry_count = COALESCE(retry_count, 0) + 1,
           status = 'pending',
           shopify_operation_id = NULL,
           started_at = NULL,
           completed_at = NULL,
           error_message = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING retry_count, max_retries`,
      [params.bulkRunId]
    );

    const row = res.rows[0];
    if (!row) return null;
    return { retryCount: row.retry_count, maxRetries: row.max_retries };
  });
}

export async function enqueueRetryOrDlq(params: {
  logger: Logger;
  shopId: string;
  bulkRunId: string;
  triggeredBy: BulkJobTriggeredBy;
  originalJob?: { queue: string; id: string | null; name: string; data: unknown };
  dlqEnqueue?: (entry: DlqEntry) => Promise<void>;
  dlqContext?: { originalQueue: string; originalJobId: string | null; originalJobName: string };
  terminalStatus: BulkTerminalStatus;
  shopifyErrorCode?: string | null;
}): Promise<'retry_enqueued' | 'dlq' | 'no_retry' | 'salvaged_partial'> {
  const decision = classifyBulkTerminalFailure({
    status: params.terminalStatus,
    shopifyErrorCode: params.shopifyErrorCode ?? null,
  });

  const info = await loadBulkRunRetryInfo(params.shopId, params.bulkRunId);
  if (!info) {
    params.logger.error(
      { shopId: params.shopId, bulkRunId: params.bulkRunId },
      'bulk_run_not_found'
    );
    return 'no_retry';
  }

  if (!decision.shouldRetry || decision.classification === 'permanent') {
    if (params.dlqEnqueue && params.dlqContext) {
      await params.dlqEnqueue({
        originalQueue: params.dlqContext.originalQueue,
        originalJobId: params.dlqContext.originalJobId,
        originalJobName: params.dlqContext.originalJobName,
        attemptsMade: 0,
        failedReason: `permanent_bulk_failure:${params.terminalStatus}:${params.shopifyErrorCode ?? ''}`,
        stacktrace: [],
        data: {
          originalJob: params.originalJob ?? null,
          errorType: decision.errorType,
          attempts: { retryCount: info.retryCount, maxRetries: info.maxRetries },
          lastError: {
            terminalStatus: params.terminalStatus,
            shopifyErrorCode: params.shopifyErrorCode ?? null,
            errorCode: decision.errorCode,
          },
          shopId: params.shopId,
          bulkRunId: params.bulkRunId,
        },
        occurredAt: new Date().toISOString(),
      });
      return 'dlq';
    }
    return 'no_retry';
  }

  if (info.retryCount >= info.maxRetries) {
    const partialDataUrl = await loadBulkRunPartialDataUrl(params.shopId, params.bulkRunId);
    if (partialDataUrl) {
      await salvageBulkRunWithPartialDataUrl({
        shopId: params.shopId,
        bulkRunId: params.bulkRunId,
        partialDataUrl,
        terminalStatus: params.terminalStatus,
        shopifyErrorCode: params.shopifyErrorCode ?? null,
      });
      return 'salvaged_partial';
    }

    if (params.dlqEnqueue && params.dlqContext) {
      await params.dlqEnqueue({
        originalQueue: params.dlqContext.originalQueue,
        originalJobId: params.dlqContext.originalJobId,
        originalJobName: params.dlqContext.originalJobName,
        attemptsMade: info.retryCount,
        failedReason: `max_retries_exceeded:${params.terminalStatus}`,
        stacktrace: [],
        data: {
          originalJob: params.originalJob ?? null,
          errorType: decision.errorType,
          attempts: { retryCount: info.retryCount, maxRetries: info.maxRetries },
          lastError: {
            terminalStatus: params.terminalStatus,
            shopifyErrorCode: params.shopifyErrorCode ?? null,
            errorCode: decision.errorCode,
          },
          shopId: params.shopId,
          bulkRunId: params.bulkRunId,
        },
        occurredAt: new Date().toISOString(),
      });
      return 'dlq';
    }
    return 'no_retry';
  }

  const updated = await requestBulkRetry({ shopId: params.shopId, bulkRunId: params.bulkRunId });
  if (!updated) return 'no_retry';

  const version = info.queryVersion ?? 'v2';
  const querySet = coerceBulkQuerySet(info.queryType) ?? 'core';
  const contract = getBulkQueryContract({ operationType: info.operationType, querySet, version });

  await enqueueBulkOrchestratorJob(
    {
      shopId: params.shopId,
      operationType: info.operationType,
      queryType: contract.querySet,
      queryVersion: contract.version,
      graphqlQuery: contract.graphqlQuery,
      ...(info.idempotencyKey ? { idempotencyKey: info.idempotencyKey } : {}),
      triggeredBy: params.triggeredBy,
      requestedAt: Date.now(),
    },
    {
      delayMs: bulkRetryBackoffMs(updated.retryCount),
    }
  );

  params.logger.warn(
    {
      shopId: params.shopId,
      bulkRunId: params.bulkRunId,
      retryCount: updated.retryCount,
      maxRetries: updated.maxRetries,
      querySet,
    },
    'Bulk retry enqueued'
  );

  return 'retry_enqueued';
}

async function loadBulkRunPartialDataUrl(
  shopId: string,
  bulkRunId: string
): Promise<string | null> {
  return await withTenantContext(shopId, async (client) => {
    const res = await client.query<{ partial_data_url: string | null }>(
      `SELECT partial_data_url
       FROM bulk_runs
       WHERE id = $1
       LIMIT 1`,
      [bulkRunId]
    );
    const value = res.rows[0]?.partial_data_url ?? null;
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return trimmed;
  });
}

async function salvageBulkRunWithPartialDataUrl(params: {
  shopId: string;
  bulkRunId: string;
  partialDataUrl: string;
  terminalStatus: BulkTerminalStatus;
  shopifyErrorCode?: string | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'completed',
           completed_at = COALESCE(completed_at, now()),
           result_url = $1,
           partial_data_url = COALESCE(partial_data_url, $1),
           updated_at = now()
       WHERE id = $2`,
      [params.partialDataUrl, params.bulkRunId]
    );

    // Record an explicit step for auditability.
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
         error_details,
         created_at,
         updated_at
       )
       VALUES ($1, $2, 'poller.completed_partial', 0, 'completed', now(), now(), NULL, $3::jsonb, now(), now())`,
      [
        params.bulkRunId,
        params.shopId,
        JSON.stringify({
          terminalStatus: params.terminalStatus,
          shopifyErrorCode: params.shopifyErrorCode ?? null,
          source: 'partialDataUrl',
        }),
      ]
    );

    // Ensure a result URL artifact exists so downstream pipeline can treat it as a normal download URL.
    const existing = await client.query<{ ok: number }>(
      `SELECT 1 as ok
       FROM bulk_artifacts
       WHERE bulk_run_id = $1
         AND shop_id = $2
         AND artifact_type = 'shopify_bulk_result_url'
         AND url = $3
       LIMIT 1`,
      [params.bulkRunId, params.shopId, params.partialDataUrl]
    );

    if (existing.rows.length === 0) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await client.query(
        `INSERT INTO bulk_artifacts (
           bulk_run_id,
           shop_id,
           artifact_type,
           file_path,
           url,
           bytes_size,
           expires_at,
           created_at
         )
         VALUES ($1, $2, 'shopify_bulk_result_url', $3, $4, NULL, $5, now())`,
        [
          params.bulkRunId,
          params.shopId,
          `shopify://bulk/${params.bulkRunId}/result`,
          params.partialDataUrl,
          expiresAt,
        ]
      );
    }

    // Record a compact bulk_error for visibility.
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
       VALUES ($1, $2, 'partial_data_url_salvaged', $3, $4, NULL, NULL, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.shopifyErrorCode ?? params.terminalStatus,
        `Run salvaged using partialDataUrl after max retries exceeded (${params.terminalStatus})`,
      ]
    );
  });

  await patchBulkRunCursorState({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    patch: {
      result: {
        source: 'partialDataUrl',
        isPartial: true,
        usedAt: new Date().toISOString(),
      },
    },
  });
}

// Helper for DLQ-direct from processors without consuming attempts.
export async function enqueueDlqDirect(params: {
  dlqQueue: DlqQueueLike | null | undefined;
  entry: DlqEntry;
}): Promise<void> {
  const q = params.dlqQueue;
  if (!q) return;

  await enqueueDlqEntry(q, params.entry);
}
