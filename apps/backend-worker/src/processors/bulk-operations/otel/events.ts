import { trace } from '@opentelemetry/api';
import { OTEL_ATTR } from '@app/logger';
import type { AttributeValue, Attributes, Span } from '@opentelemetry/api';

export type BulkEventAttributes = Attributes;

function addIfDefined(
  attrs: BulkEventAttributes,
  key: string,
  value: AttributeValue | null | undefined
): void {
  if (value === null || value === undefined) return;
  attrs[key] = value;
}

export function addBulkEvent(
  name: string,
  attributes: BulkEventAttributes,
  span?: Span | null
): void {
  const active = span ?? trace.getActiveSpan();
  if (!active) return;
  active.addEvent(name, attributes);
}

export function recordBulkStartedEvent(params: {
  shopId: string;
  bulkRunId: string;
  operationType: string;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId);
  addIfDefined(attrs, OTEL_ATTR.BULK_OPERATION_TYPE, params.operationType);
  addBulkEvent('bulk.started', attrs);
}

export function recordBulkCompletedEvent(params: {
  shopId: string;
  bulkRunId: string;
  operationType: string;
  rowsProcessed?: number | null;
  durationSeconds?: number | null;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId);
  addIfDefined(attrs, OTEL_ATTR.BULK_OPERATION_TYPE, params.operationType);
  addIfDefined(attrs, 'bulk.rows_processed', params.rowsProcessed ?? undefined);
  addIfDefined(attrs, 'bulk.duration_seconds', params.durationSeconds ?? undefined);
  addBulkEvent('bulk.completed', attrs);
}

export function recordBulkFailedEvent(params: {
  shopId: string;
  bulkRunId?: string | null;
  operationType?: string | null;
  errorType: string;
  retryable: boolean;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId ?? undefined);
  addIfDefined(attrs, OTEL_ATTR.BULK_OPERATION_TYPE, params.operationType ?? undefined);
  addIfDefined(attrs, 'bulk.error_type', params.errorType);
  addIfDefined(attrs, 'bulk.retryable', params.retryable);
  addBulkEvent('bulk.failed', attrs);
}

export function recordBulkDownloadRetryEvent(params: {
  shopId: string;
  bulkRunId: string;
  attempt: number;
  reason: string;
  delayMs?: number | null;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId);
  addIfDefined(attrs, 'bulk.retry_attempt', params.attempt);
  addIfDefined(attrs, 'bulk.retry_reason', params.reason);
  addIfDefined(attrs, 'bulk.retry_delay_ms', params.delayMs ?? undefined);
  addBulkEvent('bulk.download_retry', attrs);
}

export function recordBulkCopyAbortedEvent(params: {
  shopId: string;
  bulkRunId: string;
  reason: string;
  rowsCommitted?: number | null;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId);
  addIfDefined(attrs, 'bulk.abort_reason', params.reason);
  addIfDefined(attrs, 'bulk.rows_committed', params.rowsCommitted ?? undefined);
  addBulkEvent('bulk.copy_aborted', attrs);
}

export function recordBulkRowsQuarantinedEvent(params: {
  shopId: string;
  bulkRunId: string;
  count: number;
  sampleIds?: readonly string[] | null;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId);
  addIfDefined(attrs, 'bulk.rows_quarantined', params.count);
  const sampleIds = params.sampleIds ? Array.from(params.sampleIds) : undefined;
  addIfDefined(attrs, 'bulk.sample_ids', sampleIds);
  addBulkEvent('bulk.rows_quarantined', attrs);
}

export function recordBulkLockContentionEvent(params: {
  shopId: string;
  waitDurationMs: number;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId);
  addIfDefined(attrs, 'bulk.wait_duration', params.waitDurationMs);
  addBulkEvent('bulk.lock_contention', attrs);
}

export function recordBulkDlqEvent(params: {
  shopId?: string | null;
  bulkRunId?: string | null;
  queueName: string;
  jobName: string;
  jobId?: string | null;
}): void {
  const attrs: BulkEventAttributes = {};
  addIfDefined(attrs, OTEL_ATTR.SHOP_ID, params.shopId ?? undefined);
  addIfDefined(attrs, OTEL_ATTR.BULK_RUN_ID, params.bulkRunId ?? undefined);
  addIfDefined(attrs, OTEL_ATTR.QUEUE_NAME, params.queueName);
  addIfDefined(attrs, OTEL_ATTR.QUEUE_JOB_NAME, params.jobName);
  addIfDefined(attrs, OTEL_ATTR.QUEUE_JOB_ID, params.jobId ?? undefined);
  addBulkEvent('bulk.dlq_entry', attrs);
}
