/**
 * OpenTelemetry Metrics - COMPLETE Implementation
 *
 * CONFORM: Plan_de_implementare F3.4.4
 * CONFORM: Observability_Alerting.md - SLO metrics
 * CONFORM: SRE_Performance_Report.md - Performance targets
 *
 * Expune metrici COMPLETE pentru HTTP, webhooks, queue, DB, Redis, OAuth.
 *
 * IMPORTANT: Nu folosim shop_domain ca label (high cardinality).
 * Shop info doar în traces/logs.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, UpDownCounter, ObservableGauge } from '@opentelemetry/api';

const meter = metrics.getMeter('neanelu-shopify', '0.1.0');

// ============================================
// HTTP METRICS
// ============================================

/** Total HTTP requests (counter with labels: method, route, status_code) */
export const httpRequestTotal: Counter = meter.createCounter('http_request_total', {
  description: 'Total number of HTTP requests',
});

/** HTTP request duration in seconds (histogram with labels: method, route) */
export const httpRequestDuration: Histogram = meter.createHistogram(
  'http_request_duration_seconds',
  {
    description: 'HTTP request duration in seconds',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    },
  }
);

/** HTTP request body size in bytes */
export const httpRequestSizeBytes: Histogram = meter.createHistogram('http_request_size_bytes', {
  description: 'HTTP request body size in bytes',
  unit: 'By',
});

/** HTTP response body size in bytes */
export const httpResponseSizeBytes: Histogram = meter.createHistogram('http_response_size_bytes', {
  description: 'HTTP response body size in bytes',
  unit: 'By',
});

/** HTTP 5xx errors total - pentru SLO availability */
export const http5xxTotal: Counter = meter.createCounter('http_5xx_total', {
  description: 'Total number of HTTP 5xx errors (for SLO calculation)',
});

/** Currently active HTTP requests (gauge) */
export const httpActiveRequests: UpDownCounter = meter.createUpDownCounter('http_active_requests', {
  description: 'Number of active HTTP requests being processed',
});

// ============================================
// WEBHOOK METRICS
// ============================================

/** Webhooks accepted and enqueued (counter with labels: topic) */
export const webhookAcceptedTotal: Counter = meter.createCounter('webhook_accepted_total', {
  description: 'Total number of accepted webhooks',
});

/** Webhooks rejected (counter with labels: reason) */
export const webhookRejectedTotal: Counter = meter.createCounter('webhook_rejected_total', {
  description: 'Total number of rejected webhooks',
});

/** Webhooks deduplicated (counter with labels: topic) */
export const webhookDuplicateTotal: Counter = meter.createCounter('webhook_duplicate_total', {
  description: 'Total number of duplicate webhooks (deduplicated)',
});

// ============================================
// AI / EMBEDDINGS METRICS
// ============================================

export const aiBacklogItems: ObservableGauge = meter.createObservableGauge('ai.backlog_items', {
  description: 'Number of items waiting for AI embedding processing',
});

export const aiBatchAgeSeconds: ObservableGauge = meter.createObservableGauge(
  'ai.batch_age_seconds',
  {
    description: 'Age in seconds of the oldest AI batch being processed',
    unit: 's',
  }
);

export const aiItemsProcessedTotal: Counter = meter.createCounter('ai.items_processed_total', {
  description: 'Total number of AI embedding items processed successfully',
});

export const aiErrorsTotal: Counter = meter.createCounter('ai.errors_total', {
  description: 'Total number of AI pipeline errors',
});

export const aiQueryLatencyMs: Histogram = meter.createHistogram('ai.query_latency_ms', {
  description: 'AI vector search query latency in milliseconds',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [5, 10, 25, 50, 100, 200, 300, 500, 1000],
  },
});

export const embeddingRetryTotal: Counter = meter.createCounter('embedding_retry_total', {
  description: 'Total number of embedding retries',
});

export const embeddingDlqEntriesTotal: Counter = meter.createCounter(
  'embedding_dlq_entries_total',
  {
    description: 'Total number of embedding DLQ entries',
  }
);

export const embeddingFailedPermanentTotal: Counter = meter.createCounter(
  'embedding_failed_permanent_total',
  {
    description: 'Total number of permanent embedding failures',
  }
);

export const openaiEmbedRateLimitAllowed: Counter = meter.createCounter(
  'openai_embed_ratelimit_allowed_total',
  {
    description: 'Total embedding requests allowed by OpenAI rate limiter',
  }
);

export const openaiEmbedRateLimitDenied: Counter = meter.createCounter(
  'openai_embed_ratelimit_denied_total',
  {
    description: 'Total embedding requests denied by OpenAI rate limiter',
  }
);

export const openaiEmbedRateLimitDelaySeconds: Histogram = meter.createHistogram(
  'openai_embed_ratelimit_delay_seconds',
  {
    description: 'Delay imposed by OpenAI embedding rate limiter',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    },
  }
);

export const vectorSearchLatencySeconds: Histogram = meter.createHistogram(
  'vector_search_latency_seconds',
  {
    description: 'Latency for vector search requests',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    },
  }
);

export const vectorSearchCacheHitTotal: Counter = meter.createCounter(
  'vector_search_cache_hit_total',
  {
    description: 'Total vector search cache hits',
  }
);

export const vectorSearchCacheMissTotal: Counter = meter.createCounter(
  'vector_search_cache_miss_total',
  {
    description: 'Total vector search cache misses',
  }
);

const aiBacklogItemsState = { value: 0 };
const aiBatchAgeSecondsState = { value: 0 };

/** Webhook processing duration - total time from receive to enqueue */
export const webhookProcessingDuration: Histogram = meter.createHistogram(
  'webhook_processing_duration_seconds',
  {
    description: 'Webhook processing duration in seconds (receive to enqueue)',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    },
  }
);

/** HMAC validation duration */
export const webhookHmacDuration: Histogram = meter.createHistogram(
  'webhook_hmac_validation_duration_seconds',
  {
    description: 'HMAC validation duration in seconds',
    unit: 's',
  }
);

/** Webhook payload size in bytes */
export const webhookPayloadSizeBytes: Histogram = meter.createHistogram(
  'webhook_payload_size_bytes',
  {
    description: 'Webhook payload size in bytes',
    unit: 'By',
  }
);

// ============================================
// QUEUE METRICS (Base for F4.4)
// ============================================

/** Jobs enqueued (counter with labels: queue_name) */
export const queueEnqueueTotal: Counter = meter.createCounter('queue_enqueue_total', {
  description: 'Total number of jobs enqueued',
});

/** Queue depth - jobs waiting (gauge with labels: queue_name) */
export const queueDepth: UpDownCounter = meter.createUpDownCounter('queue_depth', {
  description: 'Number of jobs waiting in queue',
});

/** Queue active - jobs currently executing (gauge with labels: queue_name) */
export const queueActive: UpDownCounter = meter.createUpDownCounter('queue_active', {
  description: 'Number of jobs currently executing (best-effort)',
});

/** Job latency - seconds from enqueue to processing start (labels: queue_name) */
export const queueJobLatencySeconds: Histogram = meter.createHistogram(
  'queue_job_latency_seconds',
  {
    description: 'Job latency in seconds from enqueue to processing start',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    },
  }
);

/** Job duration - seconds spent processing (labels: queue_name) */
export const queueJobDurationSeconds: Histogram = meter.createHistogram(
  'queue_job_duration_seconds',
  {
    description: 'Job processing duration in seconds',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    },
  }
);

/** Jobs failed (terminal) (counter with labels: queue_name) */
export const queueJobFailedTotal: Counter = meter.createCounter('queue_job_failed_total', {
  description: 'Total number of jobs that ended in terminal failure',
});

/** Jobs stalled (counter with labels: queue_name) */
export const queueJobStalledTotal: Counter = meter.createCounter('queue_job_stalled_total', {
  description: 'Total number of stalled jobs',
});

/** Jobs retried (non-terminal failures) (counter with labels: queue_name) */
export const queueJobRetriesTotal: Counter = meter.createCounter('queue_job_retries_total', {
  description: 'Total number of job retries (non-terminal failures)',
});

/** Backoff applied before retry (seconds) (histogram with labels: queue_name) */
export const queueJobBackoffSeconds: Histogram = meter.createHistogram(
  'queue_job_backoff_seconds',
  {
    description: 'Backoff applied before retry in seconds (best-effort)',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.5, 1, 2, 4, 8, 16, 30, 60, 120, 300],
    },
  }
);

/** Jobs experiencing measurable group wait (fairness/backpressure) (counter with labels: queue_name) */
export const queueFairnessGroupDelayedTotal: Counter = meter.createCounter(
  'queue_fairness_group_delayed_total',
  {
    description: 'Total number of grouped jobs that waited >1s before processing (best-effort)',
  }
);

/** Grouped job wait time before processing (seconds) (histogram with labels: queue_name) */
export const queueFairnessGroupWaitSeconds: Histogram = meter.createHistogram(
  'queue_fairness_group_wait_seconds',
  {
    description: 'Wait time before processing for grouped jobs (best-effort)',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    },
  }
);

// ============================================
// DATABASE METRICS (Hooks)
// ============================================

/** Database query duration in seconds */
export const dbQueryDuration: Histogram = meter.createHistogram('db_query_duration_seconds', {
  description: 'Database query duration in seconds',
  unit: 's',
  advice: {
    explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  },
});

/** Active database connections from pool */
export const dbPoolConnectionsActive: UpDownCounter = meter.createUpDownCounter(
  'db_pool_connections_active',
  {
    description: 'Number of active database connections from pool',
  }
);

/** Idle database connections in pool */
export const dbPoolConnectionsIdle: UpDownCounter = meter.createUpDownCounter(
  'db_pool_connections_idle',
  {
    description: 'Number of idle database connections in pool',
  }
);

// ============================================
// BULK INGEST METRICS (F5.2.8)
// ============================================

/** Bulk operation duration in seconds (labels: operation_type, status) */
export const bulkOperationDurationSeconds: Histogram = meter.createHistogram(
  'bulk.duration_seconds',
  {
    description: 'Bulk operation duration in seconds (full lifecycle)',
    unit: 's',
    advice: {
      explicitBucketBoundaries: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200],
    },
  }
);

/** Bulk operation failures (terminal) (labels: operation_type, error_type) */
export const bulkOperationFailedTotal: Counter = meter.createCounter(
  'bulk_operation_failed_total',
  {
    description: 'Total number of terminal bulk operation failures',
  }
);

/** Bulk errors (row-level or stage errors) (labels: error_type) */
export const bulkErrorsTotal: Counter = meter.createCounter('bulk.errors_total', {
  description: 'Total number of bulk errors (row-level or stage errors)',
});

/** Bulk active operations (labels: operation_type) */
export const bulkActiveOperations: UpDownCounter = meter.createUpDownCounter(
  'bulk.active_operations',
  {
    description: 'Number of active bulk operations (best-effort)',
  }
);

/** Bulk backlog bytes (labels: operation_type) */
export const bulkBacklogBytes: ObservableGauge = meter.createObservableGauge('bulk.backlog_bytes', {
  description: 'Estimated backlog bytes for bulk operations (best-effort)',
  unit: 'By',
});

/** Oldest running bulk operation age (seconds) (labels: operation_type) */
export const bulkOperationRunningAgeSeconds: ObservableGauge = meter.createObservableGauge(
  'bulk_operation_running_age_seconds',
  {
    description: 'Age in seconds of the oldest running bulk operation (best-effort)',
    unit: 's',
  }
);

/** Total rows processed by bulk ingestion pipeline */
export const bulkRowsProcessedTotal: Counter = meter.createCounter('bulk.rows_processed_total', {
  description: 'Total number of rows processed by bulk ingestion pipeline',
});

/** Total bytes processed by bulk ingestion pipeline */
export const bulkBytesProcessedTotal: Counter = meter.createCounter('bulk.bytes_processed_total', {
  description: 'Total bytes processed by bulk ingestion pipeline',
  unit: 'By',
});

/** Ingestion throughput (rows per second) */
export const ingestionRowsPerSecond: ObservableGauge = meter.createObservableGauge(
  'ingestion_rows_per_second',
  {
    description: 'Estimated ingestion throughput in rows per second',
    unit: '1',
  }
);

const ingestionRowsPerSecondState = { value: 0 };
const bulkBacklogBytesState = new Map<string, number>();
const bulkRunningAgeState = new Map<string, number>();

meter.addBatchObservableCallback(
  (observableResult) => {
    observableResult.observe(ingestionRowsPerSecond, ingestionRowsPerSecondState.value);
  },
  [ingestionRowsPerSecond]
);

meter.addBatchObservableCallback(
  (observableResult) => {
    if (bulkBacklogBytesState.size === 0) return;
    for (const [operationType, value] of bulkBacklogBytesState.entries()) {
      observableResult.observe(bulkBacklogBytes, Math.max(0, value), {
        operation_type: operationType,
      });
    }
  },
  [bulkBacklogBytes]
);

meter.addBatchObservableCallback(
  (observableResult) => {
    if (bulkRunningAgeState.size === 0) return;
    for (const [operationType, value] of bulkRunningAgeState.entries()) {
      observableResult.observe(bulkOperationRunningAgeSeconds, Math.max(0, value), {
        operation_type: operationType,
      });
    }
  },
  [bulkOperationRunningAgeSeconds]
);

meter.addBatchObservableCallback(
  (observableResult) => {
    observableResult.observe(aiBacklogItems, Math.max(0, aiBacklogItemsState.value));
    observableResult.observe(aiBatchAgeSeconds, Math.max(0, aiBatchAgeSecondsState.value));
  },
  [aiBacklogItems, aiBatchAgeSeconds]
);

// ============================================
// REDIS METRICS
// ============================================

/** Redis command duration in seconds */
export const redisCommandDuration: Histogram = meter.createHistogram(
  'redis_command_duration_seconds',
  {
    description: 'Redis command duration in seconds',
    unit: 's',
  }
);

/** Redis connection errors */
export const redisConnectionErrors: Counter = meter.createCounter('redis_connection_errors_total', {
  description: 'Total number of Redis connection errors',
});

// ============================================
// AUTH/OAUTH METRICS
// ============================================

/** OAuth login success */
export const oauthLoginSuccess: Counter = meter.createCounter('oauth_login_success_total', {
  description: 'Total number of successful OAuth logins',
});

/** OAuth login failed (with labels: reason) */
export const oauthLoginFailed: Counter = meter.createCounter('oauth_login_failed_total', {
  description: 'Total number of failed OAuth logins',
});

/** OAuth token refresh */
export const oauthTokenRefresh: Counter = meter.createCounter('oauth_token_refresh_total', {
  description: 'Total number of OAuth token refreshes',
});

/** Shops uninstalled (lifecycle) */
export const shopUninstalledTotal: Counter = meter.createCounter('shop_uninstalled_total', {
  description: 'Total number of shops that uninstalled the app',
});

/** Webhook-driven app/uninstalled total (alias for compatibility with implementation plan wording) */
export const webhookUninstalledTotal: Counter = meter.createCounter('webhook_uninstalled_total', {
  description: 'Total number of app/uninstalled webhook events processed',
});

// ============================================
// SHOPIFY API METRICS (for rate limiting alerts)
// ============================================

/** Shopify API cost points consumed */
export const shopifyApiCostPoints: Counter = meter.createCounter('shopify_api_cost_points_total', {
  description: 'Total Shopify API cost points consumed',
});

/** Shopify rate limit hits (429 responses) */
export const shopifyRateLimitHits: Counter = meter.createCounter('shopify_rate_limit_hits_total', {
  description: 'Total number of Shopify rate limit hits (429)',
});

// ============================================
// HELPER FUNCTIONS
// ============================================

export type WebhookOutcome = 'accepted' | 'rejected' | 'duplicate';
export type RejectionReason =
  | 'missing_headers'
  | 'invalid_shop'
  | 'invalid_hmac'
  | 'payload_too_large'
  | 'invalid_json'
  | 'storage_unavailable'
  | 'shop_id_lookup_timeout'
  | 'unknown_shop';

/**
 * Record webhook metric based on outcome
 */
export function incrementWebhookMetric(
  outcome: WebhookOutcome,
  attributes: { reason?: RejectionReason; topic?: string } = {}
): void {
  switch (outcome) {
    case 'accepted':
      webhookAcceptedTotal.add(1, { topic: attributes.topic ?? 'unknown' });
      queueEnqueueTotal.add(1, { queue_name: 'webhook-queue' });
      break;
    case 'rejected':
      webhookRejectedTotal.add(1, { reason: attributes.reason ?? 'unknown' });
      break;
    case 'duplicate':
      webhookDuplicateTotal.add(1, { topic: attributes.topic ?? 'unknown' });
      break;
  }
}

/**
 * Record HTTP request metrics
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
  requestSizeBytes?: number,
  responseSizeBytes?: number
): void {
  const baseAttributes = { method, route };
  const statusAttributes = { ...baseAttributes, status_code: String(statusCode) };

  httpRequestTotal.add(1, statusAttributes);
  httpRequestDuration.record(durationSeconds, baseAttributes);

  if (statusCode >= 500) {
    http5xxTotal.add(1, statusAttributes);
  }

  if (requestSizeBytes !== undefined) {
    httpRequestSizeBytes.record(requestSizeBytes, baseAttributes);
  }

  if (responseSizeBytes !== undefined) {
    httpResponseSizeBytes.record(responseSizeBytes, baseAttributes);
  }
}

/**
 * Record webhook processing metrics
 */
export function recordWebhookProcessing(
  topic: string,
  durationSeconds: number,
  hmacDurationSeconds: number,
  payloadSizeBytes: number
): void {
  webhookProcessingDuration.record(durationSeconds, { topic });
  webhookHmacDuration.record(hmacDurationSeconds);
  webhookPayloadSizeBytes.record(payloadSizeBytes);
}

/**
 * Record database query metrics
 */
export function recordDbQuery(
  operation: 'select' | 'insert' | 'update' | 'delete' | 'copy',
  durationSeconds: number
): void {
  dbQueryDuration.record(durationSeconds, { operation });
}

/**
 * Record bulk ingestion throughput counters and gauge.
 */
export function recordBulkIngestProgress(params: {
  rowsDelta: number;
  bytesDelta: number;
  rowsPerSecond?: number;
}): void {
  const rows = Math.max(0, Math.floor(params.rowsDelta));
  const bytes = Math.max(0, Math.floor(params.bytesDelta));
  if (rows > 0) bulkRowsProcessedTotal.add(rows, { pipeline: 'bulk_ingest' });
  if (bytes > 0) bulkBytesProcessedTotal.add(bytes, { pipeline: 'bulk_ingest' });

  if (typeof params.rowsPerSecond === 'number' && Number.isFinite(params.rowsPerSecond)) {
    ingestionRowsPerSecondState.value = Math.max(0, params.rowsPerSecond);
  }
}

/** Record bulk operation duration (full lifecycle). */
export function recordBulkOperationDuration(params: {
  operationType: string;
  status: 'completed' | 'failed' | 'canceled' | 'expired' | 'unknown';
  durationSeconds: number;
}): void {
  const duration = Math.max(0, params.durationSeconds);
  bulkOperationDurationSeconds.record(duration, {
    operation_type: params.operationType,
    status: params.status,
  });
}

/** Record terminal bulk operation failure. */
export function recordBulkOperationFailure(params: {
  operationType: string;
  errorType: string;
}): void {
  bulkOperationFailedTotal.add(1, {
    operation_type: params.operationType,
    error_type: params.errorType,
  });
}

/** Record bulk error (row-level or stage). */
export function recordBulkError(params: { errorType: string }): void {
  bulkErrorsTotal.add(1, { error_type: params.errorType });
}

export function setAiBacklogItems(value: number): void {
  if (!Number.isFinite(value)) return;
  aiBacklogItemsState.value = Math.max(0, Math.floor(value));
}

export function setAiBatchAgeSeconds(value: number): void {
  if (!Number.isFinite(value)) return;
  aiBatchAgeSecondsState.value = Math.max(0, value);
}

export function recordAiItemsProcessed(count: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  aiItemsProcessedTotal.add(Math.floor(count));
}

export function recordAiError(errorType: string): void {
  const label = errorType?.trim() ? errorType.trim() : 'unknown';
  aiErrorsTotal.add(1, { error_type: label });
}

export function recordAiQueryLatencyMs(latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  aiQueryLatencyMs.record(latencyMs);
}

export function recordEmbeddingRetry(params: { embeddingType: string }): void {
  embeddingRetryTotal.add(1, { embedding_type: params.embeddingType });
}

export function recordEmbeddingDlqEntry(): void {
  embeddingDlqEntriesTotal.add(1);
}

export function recordEmbeddingPermanentFailure(params: { errorType: string }): void {
  embeddingFailedPermanentTotal.add(1, { error_type: params.errorType });
}

/** Increment bulk active operations (best-effort). */
export function incrementBulkActiveOperations(operationType: string): void {
  bulkActiveOperations.add(1, { operation_type: operationType });
}

/** Decrement bulk active operations (best-effort). */
export function decrementBulkActiveOperations(operationType: string): void {
  bulkActiveOperations.add(-1, { operation_type: operationType });
}

/** Update backlog bytes for a bulk operation type (best-effort). */
export function setBulkBacklogBytes(operationType: string, backlogBytes: number): void {
  if (!operationType) return;
  bulkBacklogBytesState.set(operationType, Math.max(0, Math.floor(backlogBytes)));
}

/** Update oldest running age for a bulk operation type (best-effort). */
export function setBulkOperationRunningAgeSeconds(operationType: string, ageSeconds: number): void {
  if (!operationType) return;
  bulkRunningAgeState.set(operationType, Math.max(0, ageSeconds));
}

/**
 * Record OAuth event
 */
export function recordOAuthEvent(
  event: 'login_success' | 'login_failed' | 'token_refresh',
  reason?: string
): void {
  switch (event) {
    case 'login_success':
      oauthLoginSuccess.add(1);
      break;
    case 'login_failed':
      oauthLoginFailed.add(1, { reason: reason ?? 'unknown' });
      break;
    case 'token_refresh':
      oauthTokenRefresh.add(1);
      break;
  }
}

/**
 * Record Shopify API usage
 */
export function recordShopifyApiUsage(costPoints: number, isRateLimited = false): void {
  shopifyApiCostPoints.add(costPoints);
  if (isRateLimited) {
    shopifyRateLimitHits.add(1);
  }
}
