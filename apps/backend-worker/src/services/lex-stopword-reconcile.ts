import { normalizeLexeme, type TenantClient } from '../processors/lex/pipeline-utils.js';

/**
 * După adăugarea unui stopword (API sau governance apply), marchează termenii existenți
 * cu același normalized_key ca opriți, șterge aparițiile și invalidează candidați/traduceri
 * nepublicate (respectă traducerile blocate manual).
 */
export interface LexStopwordReconcileResult {
  termsMarked: number;
  occurrencesDeleted: number;
  candidatesSuperseded: number;
  translationsSuperseded: number;
}

export async function reconcileLexStopwordTerms(params: {
  client: TenantClient;
  shopId: string;
  word: string;
}): Promise<LexStopwordReconcileResult> {
  const normalizedKey = normalizeLexeme(params.word);
  if (!normalizedKey) {
    return {
      termsMarked: 0,
      occurrencesDeleted: 0,
      candidatesSuperseded: 0,
      translationsSuperseded: 0,
    };
  }

  const updated = await params.client.query<{ id: string }>(
    `UPDATE lex_terms
     SET status = 'stopped',
         is_stopword = true,
         updated_at = now()
     WHERE shop_id = $1
       AND normalized_key = $2
       AND status <> 'merged'
     RETURNING id`,
    [params.shopId, normalizedKey]
  );

  const termIds = updated.rows.map((r) => r.id);
  if (termIds.length === 0) {
    return {
      termsMarked: 0,
      occurrencesDeleted: 0,
      candidatesSuperseded: 0,
      translationsSuperseded: 0,
    };
  }

  const occRes = await params.client.query(
    `DELETE FROM lex_term_occurrences
     WHERE shop_id = $1
       AND term_id = ANY($2::uuid[])`,
    [params.shopId, termIds]
  );

  const candRes = await params.client.query(
    `UPDATE lex_translation_candidates
     SET status = 'superseded',
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = ANY($2::uuid[])
       AND status <> 'superseded'`,
    [params.shopId, termIds]
  );

  const trRes = await params.client.query(
    `UPDATE lex_translations
     SET publication_status = 'superseded',
         updated_at = now()
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND term_id = ANY($2::uuid[])
       AND is_locked = false
       AND publication_status IN ('draft', 'approved', 'publishing', 'publish_failed')`,
    [params.shopId, termIds]
  );

  return {
    termsMarked: termIds.length,
    occurrencesDeleted: occRes.rowCount ?? 0,
    candidatesSuperseded: candRes.rowCount ?? 0,
    translationsSuperseded: trRes.rowCount ?? 0,
  };
}
