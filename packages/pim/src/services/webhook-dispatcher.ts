import { randomBytes } from 'node:crypto';

import type { QualityEventPayload, QualityEventType } from '@app/types';

import { getDbPool } from '../db.js';
import { computeHmacSignature } from '../utils/hmac.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

export type QualityWebhookConfigRecord = Readonly<{
  shopId: string;
  url: string | null;
  secret: string | null;
  enabled: boolean;
  subscribedEvents: QualityEventType[];
}>;

export type QualityEventRecord = Readonly<{
  id: string;
  eventType: QualityEventType;
  productId: string;
  previousLevel: string | null;
  newLevel: string;
  qualityScoreBefore: number | null;
  qualityScoreAfter: number | null;
  triggerReason: string | null;
  createdAt: string;
  webhookSent: boolean;
  webhookSentAt: string | null;
  sku: string;
}>;

export type DispatchQualityWebhookResult = Readonly<{
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number;
  timestamp: string;
  signature: string | null;
}>;

function dbOrPool(client?: DbClient): DbClient {
  return client ?? getDbPool();
}

export async function fetchWebhookConfig(
  shopId: string,
  client?: DbClient
): Promise<QualityWebhookConfigRecord> {
  const db = dbOrPool(client);
  const result = await db.query<{
    shop_id: string;
    quality_webhook_url: string | null;
    quality_webhook_secret: string | null;
    quality_webhook_enabled: boolean | null;
    quality_webhook_events: string[] | null;
  }>(
    `SELECT
       shop_id,
       quality_webhook_url,
       quality_webhook_secret,
       quality_webhook_enabled,
       quality_webhook_events
     FROM shop_ai_credentials
     WHERE shop_id = $1
     LIMIT 1`,
    [shopId]
  );
  const row = result.rows[0];
  if (!row) {
    return {
      shopId,
      url: null,
      secret: null,
      enabled: false,
      subscribedEvents: [],
    };
  }

  const subscribed = (row.quality_webhook_events ?? []).filter(
    (evt): evt is QualityEventType =>
      evt === 'quality_promoted' ||
      evt === 'quality_demoted' ||
      evt === 'review_requested' ||
      evt === 'milestone_reached'
  );

  return {
    shopId: row.shop_id,
    url: row.quality_webhook_url,
    secret: row.quality_webhook_secret,
    enabled: Boolean(row.quality_webhook_enabled),
    subscribedEvents: subscribed,
  };
}

export async function upsertWebhookConfig(
  params: {
    shopId: string;
    url: string | null;
    secret: string | null;
    enabled: boolean;
    subscribedEvents: QualityEventType[];
  },
  client?: DbClient
): Promise<void> {
  const db = dbOrPool(client);
  await db.query(
    `INSERT INTO shop_ai_credentials (
       shop_id,
       quality_webhook_url,
       quality_webhook_secret,
       quality_webhook_enabled,
       quality_webhook_events,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5::text[], now())
     ON CONFLICT (shop_id)
     DO UPDATE SET
       quality_webhook_url = EXCLUDED.quality_webhook_url,
       quality_webhook_secret = EXCLUDED.quality_webhook_secret,
       quality_webhook_enabled = EXCLUDED.quality_webhook_enabled,
       quality_webhook_events = EXCLUDED.quality_webhook_events,
       updated_at = now()`,
    [params.shopId, params.url, params.secret, params.enabled, params.subscribedEvents]
  );
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export async function getQualityEventById(
  eventId: string,
  client?: DbClient
): Promise<QualityEventRecord | null> {
  const db = dbOrPool(client);
  const result = await db.query<{
    id: string;
    event_type: QualityEventType;
    product_id: string;
    previous_level: string | null;
    new_level: string;
    quality_score_before: string | null;
    quality_score_after: string | null;
    trigger_reason: string | null;
    created_at: string;
    webhook_sent: boolean;
    webhook_sent_at: string | null;
    internal_sku: string;
  }>(
    `SELECT
       qe.id,
       qe.event_type,
       qe.product_id,
       qe.previous_level,
       qe.new_level,
       qe.quality_score_before::text,
       qe.quality_score_after::text,
       qe.trigger_reason,
       qe.created_at,
       qe.webhook_sent,
       qe.webhook_sent_at,
       pm.internal_sku
     FROM prod_quality_events qe
     JOIN prod_master pm ON pm.id = qe.product_id
     WHERE qe.id = $1
     LIMIT 1`,
    [eventId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    eventType: row.event_type,
    productId: row.product_id,
    previousLevel: row.previous_level,
    newLevel: row.new_level,
    qualityScoreBefore: row.quality_score_before == null ? null : Number(row.quality_score_before),
    qualityScoreAfter: row.quality_score_after == null ? null : Number(row.quality_score_after),
    triggerReason: row.trigger_reason,
    createdAt: row.created_at,
    webhookSent: row.webhook_sent,
    webhookSentAt: row.webhook_sent_at,
    sku: row.internal_sku,
  };
}

export function buildQualityPayload(
  event: QualityEventRecord,
  shopId: string
): QualityEventPayload {
  return {
    event_type: event.eventType,
    event_id: event.id,
    product_id: event.productId,
    sku: event.sku,
    previous_level: event.previousLevel,
    new_level: event.newLevel,
    quality_score: event.qualityScoreAfter ?? event.qualityScoreBefore ?? 0,
    trigger_reason: event.triggerReason ?? 'unknown',
    timestamp: event.createdAt,
    shop_id: shopId,
  };
}

export async function dispatchQualityWebhook(params: {
  url: string;
  payload: QualityEventPayload;
  secret?: string | null;
  timeoutMs?: number;
}): Promise<DispatchQualityWebhookResult> {
  const body = JSON.stringify(params.payload);
  const timeoutMs = Math.max(1, params.timeoutMs ?? 10_000);
  const controller = new AbortController();
  const started = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let responseBody: string | null = null;
  try {
    const timestamp = String(Date.now());
    const signature =
      params.secret && params.secret.length > 0
        ? computeHmacSignature(params.secret, timestamp, body)
        : null;
    const response = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neanelu-Event': params.payload.event_type,
        'X-Neanelu-Timestamp': timestamp,
        ...(signature ? { 'X-Neanelu-Signature': signature } : {}),
      },
      body,
      signal: controller.signal,
    });
    responseBody = await response.text().catch(() => null);
    const durationMs = Math.max(0, Date.now() - started);
    return {
      ok: response.ok,
      httpStatus: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      responseBody,
      durationMs,
      timestamp,
      signature,
    };
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      httpStatus: null,
      error: message,
      responseBody,
      durationMs,
      timestamp: String(Date.now()),
      signature: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function logWebhookDelivery(
  params: {
    eventId: string;
    shopId: string;
    url: string;
    eventType: QualityEventType;
    httpStatus: number | null;
    durationMs: number;
    responseBody: string | null;
    attempt: number;
    errorMessage: string | null;
  },
  client?: DbClient
): Promise<void> {
  const db = dbOrPool(client);
  await db.query(
    `INSERT INTO quality_webhook_deliveries (
       event_id,
       shop_id,
       url,
       event_type,
       http_status,
       duration_ms,
       response_body,
       attempt,
       error_message,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      params.eventId,
      params.shopId,
      params.url,
      params.eventType,
      params.httpStatus,
      params.durationMs,
      params.responseBody,
      params.attempt,
      params.errorMessage,
    ]
  );
}

export async function listWebhookDeliveries(
  params: {
    shopId: string;
    limit: number;
    offset: number;
    eventType?: QualityEventType | null;
    status?: 'success' | 'failed' | null;
  },
  client?: DbClient
): Promise<{
  items: {
    id: string;
    eventId: string;
    eventType: string | null;
    url: string;
    httpStatus: number | null;
    durationMs: number | null;
    attempt: number;
    responseBody: string | null;
    errorMessage: string | null;
    createdAt: string;
  }[];
  totalCount: number;
}> {
  const db = dbOrPool(client);
  const result = await db.query<{
    id: string;
    event_id: string;
    event_type: string | null;
    url: string;
    http_status: number | null;
    duration_ms: number | null;
    attempt: number;
    response_body: string | null;
    error_message: string | null;
    created_at: string;
  }>(
    `SELECT
       id,
       event_id,
       event_type,
       url,
       http_status,
       duration_ms,
       attempt,
       response_body,
       error_message,
       created_at
     FROM quality_webhook_deliveries
     WHERE shop_id = $1
       AND ($2::text IS NULL OR event_type = $2)
       AND (
         $3::text IS NULL OR
         ($3 = 'success' AND http_status BETWEEN 200 AND 299) OR
         ($3 = 'failed' AND (http_status IS NULL OR http_status < 200 OR http_status > 299))
       )
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    [params.shopId, params.eventType ?? null, params.status ?? null, params.limit, params.offset]
  );
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM quality_webhook_deliveries
     WHERE shop_id = $1
       AND ($2::text IS NULL OR event_type = $2)
       AND (
         $3::text IS NULL OR
         ($3 = 'success' AND http_status BETWEEN 200 AND 299) OR
         ($3 = 'failed' AND (http_status IS NULL OR http_status < 200 OR http_status > 299))
       )`,
    [params.shopId, params.eventType ?? null, params.status ?? null]
  );

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventType: row.event_type,
      url: row.url,
      httpStatus: row.http_status,
      durationMs: row.duration_ms,
      attempt: row.attempt,
      responseBody: row.response_body,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
    totalCount: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function markEventWebhookSent(eventId: string, client?: DbClient): Promise<void> {
  const db = dbOrPool(client);
  await db.query(
    `UPDATE prod_quality_events
     SET webhook_sent = true,
         webhook_sent_at = now()
     WHERE id = $1`,
    [eventId]
  );
}

export async function resetEventWebhookPending(eventId: string, client?: DbClient): Promise<void> {
  const db = dbOrPool(client);
  await db.query(
    `UPDATE prod_quality_events
     SET webhook_sent = false,
         webhook_sent_at = NULL
     WHERE id = $1`,
    [eventId]
  );
}
