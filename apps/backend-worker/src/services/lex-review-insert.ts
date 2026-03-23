/**
 * Race-safe enqueue into lex_review_items using partial unique index
 * idx_lex_review_items_shop_entity_reason_open_unique (migration 0127).
 */

export interface LexReviewOpenInsertRow {
  entityType: string;
  entityId: string;
  reviewReason: string;
  severity: 'medium' | 'high';
  evidence: Record<string, unknown>;
}

interface QueryableClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: TRow[] }>;
}

/**
 * Batch INSERT with ON CONFLICT DO NOTHING against the partial unique index on open statuses.
 * Returns the number of rows actually inserted.
 */
export async function insertLexReviewOpenItemsBatch(params: {
  client: QueryableClient;
  shopId: string;
  /** Nullable for paths that enqueue outside a run (e.g. publish conflict). */
  runId: string | null;
  rows: readonly LexReviewOpenInsertRow[];
}): Promise<number> {
  const rows = params.rows;
  if (rows.length === 0) {
    return 0;
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let p = 1;
  for (const r of rows) {
    placeholders.push(
      `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, CASE WHEN $${p + 5} = 'high' THEN 50 ELSE 100 END, 'pending', $${p + 6}::jsonb, now(), now())`
    );
    values.push(
      params.shopId,
      params.runId,
      r.entityType,
      r.entityId,
      r.reviewReason,
      r.severity,
      JSON.stringify(r.evidence)
    );
    p += 7;
  }

  const res = await params.client.query<{ id: string }>(
    `INSERT INTO lex_review_items
       (shop_id, run_id, entity_type, entity_id, review_reason, severity, priority, status, evidence, created_at, updated_at)
     VALUES
       ${placeholders.join(', ')}
     ON CONFLICT (shop_id, entity_type, entity_id, review_reason)
       WHERE (status IN ('pending', 'in_review'))
     DO NOTHING
     RETURNING id`,
    values
  );
  return res.rows.length;
}
