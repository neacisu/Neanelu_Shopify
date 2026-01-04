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
import type { Counter, Histogram, UpDownCounter } from '@opentelemetry/api';

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
  | 'storage_unavailable';

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
