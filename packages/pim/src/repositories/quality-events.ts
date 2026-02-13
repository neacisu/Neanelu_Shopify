import { getDbPool } from '../db.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

export type QualityEvent = Readonly<{
  id: string;
  productId: string;
  eventType: string;
  previousLevel: string | null;
  newLevel: string;
  qualityScoreBefore: string | null;
  qualityScoreAfter: string | null;
  triggerReason: string;
  triggerDetails: Record<string, unknown> | null;
  triggeredBy: string | null;
  jobId: string | null;
  webhookSent: boolean;
  webhookSentAt: string | null;
  createdAt: string;
}>;

export async function logQualityEvent(params: {
  client?: DbClient;
  productId: string;
  eventType: 'quality_promoted' | 'quality_demoted' | 'review_requested' | 'milestone_reached';
  previousLevel: string | null;
  newLevel: string;
  qualityScoreBefore: number | null;
  qualityScoreAfter: number;
  triggerReason: string;
  triggerDetails?: Record<string, unknown>;
  triggeredBy?: string | null;
  jobId?: string;
}): Promise<string> {
  const db = params.client ?? getDbPool();
  const result = await db.query<{ id: string }>(
    `INSERT INTO prod_quality_events (
       product_id,
       event_type,
       previous_level,
       new_level,
       quality_score_before,
       quality_score_after,
       trigger_reason,
       trigger_details,
       triggered_by,
       job_id,
       webhook_sent,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, now())
     RETURNING id`,
    [
      params.productId,
      params.eventType,
      params.previousLevel,
      params.newLevel,
      params.qualityScoreBefore,
      params.qualityScoreAfter,
      params.triggerReason,
      params.triggerDetails ?? {},
      params.triggeredBy ?? null,
      params.jobId ?? null,
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to insert prod_quality_events row.');
  }
  return row.id;
}

export async function getRecentEvents(
  productId: string,
  limit = 20,
  client?: DbClient
): Promise<QualityEvent[]> {
  const db = client ?? getDbPool();
  const result = await db.query<QualityEvent>(
    `SELECT
       id,
       product_id as "productId",
       event_type as "eventType",
       previous_level as "previousLevel",
       new_level as "newLevel",
       quality_score_before as "qualityScoreBefore",
       quality_score_after as "qualityScoreAfter",
       trigger_reason as "triggerReason",
       trigger_details as "triggerDetails",
       triggered_by as "triggeredBy",
       job_id as "jobId",
       webhook_sent as "webhookSent",
       webhook_sent_at as "webhookSentAt",
       created_at as "createdAt"
     FROM prod_quality_events
    WHERE product_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [productId, limit]
  );
  return result.rows;
}

export async function getPendingWebhookEvents(
  limit = 100,
  maxAgeDays = 7
): Promise<QualityEvent[]> {
  const pool = getDbPool();
  const result = await pool.query<QualityEvent>(
    `SELECT
       id,
       product_id as "productId",
       event_type as "eventType",
       previous_level as "previousLevel",
       new_level as "newLevel",
       quality_score_before as "qualityScoreBefore",
       quality_score_after as "qualityScoreAfter",
       trigger_reason as "triggerReason",
       trigger_details as "triggerDetails",
       triggered_by as "triggeredBy",
       job_id as "jobId",
       webhook_sent as "webhookSent",
       webhook_sent_at as "webhookSentAt",
       created_at as "createdAt"
     FROM prod_quality_events
    WHERE webhook_sent = false
      AND created_at > now() - make_interval(days => $2::int)
    ORDER BY created_at ASC
    LIMIT $1`,
    [limit, maxAgeDays]
  );
  return result.rows;
}
