import { randomUUID } from 'node:crypto';

import { withTenantContext } from '@app/database';
import type { LexAssignReviewRequest, LexDecisionType, LexReviewDecisionRequest } from '@app/types';

import { enqueueLexPublishJob } from '../queue/lex-queues.js';
import type { TenantClient } from '../processors/lex/pipeline-types.js';

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    ),
  ];
}

/** Rezolvă ID-ul termenului țintă din `newValue` la decizia `merge_terms` (alias istoric `survivorTermId`). */
export function resolveMergeTermsTargetTermIdFromNewValue(newValue: unknown): string | null {
  const o = toJsonObject(newValue);
  if (typeof o['targetTermId'] === 'string') return o['targetTermId'];
  if (typeof o['survivorTermId'] === 'string') return o['survivorTermId'];
  return null;
}

function parseSqlAvgToNumber(row: { avg: string | null } | undefined): number {
  const raw = row?.avg;
  return raw == null ? Number.NaN : Number(raw);
}

function deriveConfidenceFromSplitSelection(avgNewSim: number, sourceConf: number): number {
  if (Number.isFinite(avgNewSim) && avgNewSim > 0) {
    return avgNewSim;
  }
  if (Number.isFinite(sourceConf)) {
    return sourceConf * 0.95;
  }
  return 0.72;
}

/** Confidence pentru cluster nou / recalculat după split (DECIMAL(5,4) în DB). */
function clampLexClusterConfidence(value: number): string {
  const n = Number.isFinite(value) ? value : 0.72;
  const c = Math.min(0.92, Math.max(0.55, n));
  return c.toFixed(4);
}

/**
 * Status final al item-ului de review după o decizie (f3-04).
 * `assign` se rezolvă doar prin `assignLexReviewItem`, nu prin `decideLexReviewItem`.
 */
export function finalLexReviewItemStatus(decisionType: LexDecisionType): 'approved' | 'rejected' {
  switch (decisionType) {
    case 'reject':
      return 'rejected';
    case 'approve':
    case 'merge_terms':
    case 'split_cluster':
    case 'lock_translation':
    case 'publish':
      return 'approved';
    case 'assign':
      throw new Error('assign_requires_assign_endpoint');
    default: {
      const _exhaustive: never = decisionType;
      throw new Error(`unknown_decision_type:${String(_exhaustive as unknown)}`);
    }
  }
}

async function insertDecision(params: {
  client: TenantClient;
  reviewItemId: string;
  shopId: string;
  entityType: string;
  entityId: string;
  decisionType: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  decisionNotes?: string | null;
  decidedBy: string | null;
}): Promise<string | null> {
  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO lex_decisions
       (review_item_id, shop_id, entity_type, entity_id, decision_type, old_value, new_value, decided_by, decision_notes, created_at)
     VALUES
       ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
     RETURNING id`,
    [
      params.reviewItemId,
      params.shopId,
      params.entityType,
      params.entityId,
      params.decisionType,
      JSON.stringify(params.oldValue ?? {}),
      JSON.stringify(params.newValue ?? {}),
      params.decidedBy,
      params.decisionNotes ?? null,
    ]
  );
  return inserted.rows[0]?.id ?? null;
}

async function mergeTerms(params: {
  client: TenantClient;
  shopId: string;
  sourceTermId: string;
  targetTermId: string;
}): Promise<void> {
  if (params.sourceTermId === params.targetTermId) return;

  const sourceExists = await params.client.query<{ id: string }>(
    `SELECT id FROM lex_terms
     WHERE id = $1
       AND (shop_id = $2 OR shop_id IS NULL)
     LIMIT 1`,
    [params.sourceTermId, params.shopId]
  );
  if (!sourceExists.rows[0]) {
    throw new Error('merge_terms_source_not_found');
  }

  const targetExists = await params.client.query<{ id: string }>(
    `SELECT id FROM lex_terms
     WHERE id = $1
       AND (shop_id = $2 OR shop_id IS NULL)
     LIMIT 1`,
    [params.targetTermId, params.shopId]
  );
  if (!targetExists.rows[0]) {
    throw new Error('merge_terms_target_not_found');
  }

  const conflictingContexts = await params.client.query<{ sourceId: string; targetId: string }>(
    `SELECT s.id AS "sourceId", t.id AS "targetId"
     FROM lex_term_contexts s
     INNER JOIN lex_term_contexts t
             ON t.shop_id = s.shop_id
            AND t.term_id = $3
            AND t.context_hash = s.context_hash
     WHERE s.shop_id = $1
       AND s.term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  for (const row of conflictingContexts.rows) {
    await params.client.query(
      `INSERT INTO lex_sense_cluster_members (cluster_id, context_id, similarity_score, is_representative, created_at)
       SELECT m.cluster_id, $2, m.similarity_score, m.is_representative, now()
       FROM lex_sense_cluster_members m
       INNER JOIN lex_sense_clusters c
               ON c.id = m.cluster_id
              AND (c.shop_id = $3 OR c.shop_id IS NULL)
       WHERE m.context_id = $1
       ON CONFLICT (cluster_id, context_id) DO NOTHING`,
      [row.sourceId, row.targetId, params.shopId]
    );
    await params.client.query(
      `UPDATE lex_sense_clusters
       SET representative_context_id = $2,
           updated_at = now()
       WHERE representative_context_id = $1`,
      [row.sourceId, row.targetId]
    );
    await params.client.query(
      `DELETE FROM lex_sense_cluster_members AS m
       USING lex_sense_clusters AS c
       WHERE m.context_id = $1
         AND m.cluster_id = c.id
         AND (c.shop_id = $2 OR c.shop_id IS NULL)`,
      [row.sourceId, params.shopId]
    );
    await params.client.query(`DELETE FROM lex_context_embeddings WHERE context_id = $1`, [
      row.sourceId,
    ]);
    await params.client.query(`DELETE FROM lex_term_contexts WHERE id = $1`, [row.sourceId]);
  }

  await params.client.query(
    `UPDATE lex_term_contexts
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `DELETE FROM lex_term_variants v_src
     USING lex_term_variants v_tgt
     WHERE v_src.shop_id = $1
       AND v_tgt.shop_id = $1
       AND v_src.term_id = $2
       AND v_tgt.term_id = $3
       AND v_src.normalized_variant = v_tgt.normalized_variant
       AND v_src.locale = v_tgt.locale`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `UPDATE lex_term_variants
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_term_occurrences
     SET term_id = $3
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_sense_clusters
     SET term_id = $3,
         updated_at = now()
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `DELETE FROM lex_translation_candidates c_src
     USING lex_translation_candidates c_tgt
     WHERE c_src.shop_id = $1
       AND c_tgt.shop_id = $1
       AND c_src.term_id = $2
       AND c_tgt.term_id = $3
       AND c_src.cluster_id IS NOT DISTINCT FROM c_tgt.cluster_id
       AND c_src.source_lang = c_tgt.source_lang
       AND c_src.target_lang = c_tgt.target_lang
       AND c_src.rank = c_tgt.rank`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_translation_candidates
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `DELETE FROM lex_translations t_src
     USING lex_translations t_tgt
     WHERE t_src.term_id = $2
       AND t_tgt.term_id = $3
       AND t_src.shop_id IS NOT DISTINCT FROM t_tgt.shop_id
       AND t_src.cluster_id IS NOT DISTINCT FROM t_tgt.cluster_id
       AND t_src.source_lang = t_tgt.source_lang
       AND t_src.target_lang = t_tgt.target_lang`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_translations
     SET term_id = $3,
         updated_at = now()
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `DELETE FROM lex_attribute_resolution_candidates a_src
     USING lex_attribute_resolution_candidates a_tgt
     WHERE a_src.shop_id = $1
       AND a_tgt.shop_id = $1
       AND a_src.term_id = $2
       AND a_tgt.term_id = $3
       AND COALESCE(a_src.cluster_id, '00000000-0000-0000-0000-000000000000'::uuid) =
           COALESCE(a_tgt.cluster_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(a_src.definition_id, '00000000-0000-0000-0000-000000000000'::uuid) =
           COALESCE(a_tgt.definition_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND a_src.resolution_role = a_tgt.resolution_role`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_attribute_resolution_candidates
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `DELETE FROM lex_attribute_resolutions r_src
     USING lex_attribute_resolutions r_tgt
     WHERE r_src.term_id = $2
       AND r_tgt.term_id = $3
       AND r_src.shop_id IS NOT DISTINCT FROM r_tgt.shop_id
       AND r_src.cluster_id IS NOT DISTINCT FROM r_tgt.cluster_id
       AND r_src.definition_id = r_tgt.definition_id
       AND r_src.resolution_role = r_tgt.resolution_role`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `UPDATE lex_attribute_resolutions
     SET term_id = $3,
         updated_at = now()
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND term_id = $2`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `UPDATE lex_review_items
     SET entity_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND entity_type = 'term'
       AND entity_id = $2
       AND status IN ('pending', 'in_review')`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `UPDATE lex_terms
     SET status = 'merged',
         merged_into_term_id = $3,
         updated_at = now()
     WHERE id = $2
       AND (shop_id = $1 OR shop_id IS NULL)`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );

  await params.client.query(
    `INSERT INTO lex_term_stats
       (shop_id, term_id, last_run_id, occurrences_total, distinct_fragments, distinct_products, distinct_variants, distinct_collections,
        title_occurrences, description_occurrences, metafield_occurrences, vendor_occurrences, score_global, score_tfidf, score_domain, updated_at)
     SELECT
       $1,
       $3,
       COALESCE(
         (SELECT last_run_id FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1),
         (SELECT last_run_id FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1)
       ),
       agg.occurrences_total,
       agg.distinct_fragments,
       agg.distinct_products,
       agg.distinct_variants,
       agg.distinct_collections,
       COALESCE((SELECT title_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1), 0)
         + COALESCE((SELECT title_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1), 0),
       COALESCE((SELECT description_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1), 0)
         + COALESCE((SELECT description_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1), 0),
       COALESCE((SELECT metafield_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1), 0)
         + COALESCE((SELECT metafield_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1), 0),
       COALESCE((SELECT vendor_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1), 0)
         + COALESCE((SELECT vendor_occurrences FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1), 0),
       COALESCE(
         (SELECT score_global FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1),
         (SELECT score_global FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1)
       ),
       COALESCE(
         (SELECT score_tfidf FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1),
         (SELECT score_tfidf FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1)
       ),
       COALESCE(
         (SELECT score_domain FROM lex_term_stats WHERE shop_id = $1 AND term_id = $3 LIMIT 1),
         (SELECT score_domain FROM lex_term_stats WHERE shop_id = $1 AND term_id = $2 LIMIT 1)
       ),
       now()
     FROM (
       SELECT
         COUNT(*)::bigint AS occurrences_total,
         COUNT(DISTINCT o.fragment_id)::bigint AS distinct_fragments,
         COUNT(DISTINCT f.product_id) FILTER (WHERE f.product_id IS NOT NULL)::bigint AS distinct_products,
         COUNT(DISTINCT f.variant_id) FILTER (WHERE f.variant_id IS NOT NULL)::bigint AS distinct_variants,
         COUNT(DISTINCT f.collection_id) FILTER (WHERE f.collection_id IS NOT NULL)::bigint AS distinct_collections
       FROM lex_term_occurrences o
       INNER JOIN lex_fragments f ON f.id = o.fragment_id AND f.shop_id = o.shop_id
       WHERE o.shop_id = $1 AND o.term_id = $3
     ) AS agg
     ON CONFLICT (shop_id, term_id)
     DO UPDATE
        SET last_run_id = EXCLUDED.last_run_id,
            occurrences_total = EXCLUDED.occurrences_total,
            distinct_fragments = EXCLUDED.distinct_fragments,
            distinct_products = EXCLUDED.distinct_products,
            distinct_variants = EXCLUDED.distinct_variants,
            distinct_collections = EXCLUDED.distinct_collections,
            title_occurrences = EXCLUDED.title_occurrences,
            description_occurrences = EXCLUDED.description_occurrences,
            metafield_occurrences = EXCLUDED.metafield_occurrences,
            vendor_occurrences = EXCLUDED.vendor_occurrences,
            score_global = EXCLUDED.score_global,
            score_tfidf = EXCLUDED.score_tfidf,
            score_domain = EXCLUDED.score_domain,
            updated_at = now()`,
    [params.shopId, params.sourceTermId, params.targetTermId]
  );
  await params.client.query(
    `DELETE FROM lex_term_stats
     WHERE shop_id = $1
       AND term_id = $2`,
    [params.shopId, params.sourceTermId]
  );
}

async function splitCluster(params: {
  client: TenantClient;
  shopId: string;
  sourceClusterId: string;
  selectedContextIds: string[];
}): Promise<string | null> {
  const sourceRes = await params.client.query<{
    termId: string;
    clusterKey: string;
    clusterMethod: string;
    domainCode: string | null;
    taxonomyId: string | null;
    labelRo: string | null;
    labelEn: string | null;
    description: string | null;
    confidenceScore: string | null;
  }>(
    `SELECT
       term_id AS "termId",
       cluster_key AS "clusterKey",
       cluster_method AS "clusterMethod",
       domain_code AS "domainCode",
       taxonomy_id::text AS "taxonomyId",
       label_ro AS "labelRo",
       label_en AS "labelEn",
       description,
       confidence_score::text AS "confidenceScore"
     FROM lex_sense_clusters
     WHERE id = $1
       AND (shop_id = $2 OR shop_id IS NULL)
     LIMIT 1
     FOR UPDATE`,
    [params.sourceClusterId, params.shopId]
  );
  const source = sourceRes.rows[0];
  if (!source) return null;

  const belongRes = await params.client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $3 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1
       AND m.context_id = ANY($2::uuid[])`,
    [params.sourceClusterId, params.selectedContextIds, params.shopId]
  );
  const belongCount = Number(belongRes.rows[0]?.cnt ?? '0');
  if (belongCount !== params.selectedContextIds.length) {
    throw new Error('split_cluster_contexts_not_in_cluster');
  }

  const avgNewRes = await params.client.query<{ avg: string | null }>(
    `SELECT AVG(m.similarity_score)::text AS avg
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $3 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1
       AND m.context_id = ANY($2::uuid[])`,
    [params.sourceClusterId, params.selectedContextIds, params.shopId]
  );
  const avgNewSim = parseSqlAvgToNumber(avgNewRes.rows[0]);
  const sourceConf =
    source.confidenceScore != null && source.confidenceScore !== ''
      ? Number(source.confidenceScore)
      : Number.NaN;
  const derivedNew = deriveConfidenceFromSplitSelection(avgNewSim, sourceConf);
  const newClusterConfidence = clampLexClusterConfidence(derivedNew);

  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO lex_sense_clusters
       (shop_id, term_id, cluster_key, cluster_method, domain_code, taxonomy_id, label_ro, label_en, description,
        origin_cluster_id, confidence_score, needs_review, is_approved, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, true, false, now(), now())
     RETURNING id`,
    [
      params.shopId,
      source.termId,
      `split:${params.sourceClusterId}:${randomUUID()}`,
      source.clusterMethod,
      source.domainCode,
      source.taxonomyId,
      source.labelRo,
      source.labelEn,
      source.description,
      params.sourceClusterId,
      newClusterConfidence,
    ]
  );
  const newClusterId = inserted.rows[0]?.id ?? null;
  if (!newClusterId) return null;

  await params.client.query(
    `INSERT INTO lex_sense_cluster_members (cluster_id, context_id, similarity_score, is_representative, created_at)
     SELECT $2, m.context_id, m.similarity_score, m.is_representative, now()
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $4 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1
       AND m.context_id = ANY($3::uuid[])
     ON CONFLICT (cluster_id, context_id) DO NOTHING`,
    [params.sourceClusterId, newClusterId, params.selectedContextIds, params.shopId]
  );

  await params.client.query(
    `DELETE FROM lex_sense_cluster_members AS m
     USING lex_sense_clusters AS sc
     WHERE m.cluster_id = sc.id
       AND (sc.shop_id = $3 OR sc.shop_id IS NULL)
       AND m.cluster_id = $1
       AND m.context_id = ANY($2::uuid[])`,
    [params.sourceClusterId, params.selectedContextIds, params.shopId]
  );

  const newRep = await params.client.query<{ contextId: string }>(
    `SELECT m.context_id AS "contextId"
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $2 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1
     ORDER BY m.is_representative DESC, m.similarity_score DESC NULLS LAST, m.created_at ASC
     LIMIT 1`,
    [newClusterId, params.shopId]
  );
  const sourceRep = await params.client.query<{ contextId: string }>(
    `SELECT m.context_id AS "contextId"
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $2 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1
     ORDER BY m.is_representative DESC, m.similarity_score DESC NULLS LAST, m.created_at ASC
     LIMIT 1`,
    [params.sourceClusterId, params.shopId]
  );

  await params.client.query(
    `UPDATE lex_sense_clusters
     SET representative_context_id = $2,
         needs_review = true,
         is_approved = false,
         updated_at = now()
     WHERE id = $1`,
    [newClusterId, newRep.rows[0]?.contextId ?? null]
  );
  await params.client.query(
    `UPDATE lex_sense_clusters
     SET representative_context_id = $2,
         needs_review = true,
         is_approved = false,
         updated_at = now()
     WHERE id = $1`,
    [params.sourceClusterId, sourceRep.rows[0]?.contextId ?? null]
  );

  const sourceAvgRes = await params.client.query<{ avg: string | null }>(
    `SELECT AVG(m.similarity_score)::text AS avg
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $2 OR sc.shop_id IS NULL)
     WHERE m.cluster_id = $1`,
    [params.sourceClusterId, params.shopId]
  );
  const avgSourceRem = parseSqlAvgToNumber(sourceAvgRes.rows[0]);
  const derivedSource =
    Number.isFinite(avgSourceRem) && avgSourceRem > 0 ? avgSourceRem : sourceConf;
  await params.client.query(
    `UPDATE lex_sense_clusters
     SET confidence_score = $2::numeric,
         updated_at = now()
     WHERE id = $1`,
    [params.sourceClusterId, clampLexClusterConfidence(derivedSource)]
  );

  await params.client.query(
    `UPDATE lex_translations
     SET publication_status = 'draft',
         updated_at = now()
     WHERE cluster_id IN ($1, $2)`,
    [params.sourceClusterId, newClusterId]
  );

  await params.client.query(
    `WITH impacted AS (
       SELECT DISTINCT localization_id
       FROM lex_entity_localization_evidence
       WHERE cluster_id IN ($1, $2)
     )
     UPDATE lex_entity_localizations
     SET publication_status = 'superseded',
         updated_at = now()
     WHERE id IN (SELECT localization_id FROM impacted)`,
    [params.sourceClusterId, newClusterId]
  );

  await params.client.query(
    `WITH impacted AS (
       SELECT DISTINCT localization_id
       FROM lex_entity_localization_evidence
       WHERE cluster_id IN ($1, $2)
     )
     UPDATE lex_publication_targets
     SET status = 'cancelled',
         updated_at = now()
     WHERE localization_id IN (SELECT localization_id FROM impacted)
       AND status IN ('pending', 'published', 'failed')`,
    [params.sourceClusterId, newClusterId]
  );

  return newClusterId;
}

async function enqueueReviewPublish(params: {
  client: TenantClient;
  shopId: string;
  entityId: string;
}): Promise<{ queueJobId: string | null; localizationId: string | null }> {
  const localizationRes = await params.client.query<{
    id: string;
    entityType: string;
    entityRecordId: string;
  }>(
    `SELECT
       id,
       entity_type AS "entityType",
       entity_id AS "entityRecordId"
     FROM lex_entity_localizations
     WHERE shop_id = $1
       AND (id = $2 OR entity_id = $2)
       AND publication_status IN ('approved', 'published')
     ORDER BY approved_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.entityId]
  );
  const localization = localizationRes.rows[0];
  if (!localization) return { queueJobId: null, localizationId: null };

  const targets = await params.client.query<{ id: string; targetType: string }>(
    `SELECT id, target_type AS "targetType"
     FROM lex_publication_targets
     WHERE shop_id = $1
       AND localization_id = $2`,
    [params.shopId, localization.id]
  );

  const targetIds = targets.rows.map((row) => row.id);
  const queueJobId =
    targetIds.length > 0
      ? await enqueueLexPublishJob({
          shopId: params.shopId,
          targetIds,
          requestedAt: Date.now(),
        })
      : null;

  return { queueJobId, localizationId: localization.id };
}

export async function assignLexReviewItem(params: {
  shopId: string;
  reviewItemId: string;
  body: LexAssignReviewRequest;
  actorId: string | null;
}): Promise<{ reviewItemId: string; decisionId: string | null; nextVersion: number } | null> {
  return await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query<{
        id: string;
        entityType: string;
        entityId: string;
        version: number;
        status: string;
        assignedTo: string | null;
      }>(
        `SELECT id, entity_type AS "entityType", entity_id AS "entityId", version, status, assigned_to AS "assignedTo"
         FROM lex_review_items
         WHERE id = $1
           AND shop_id = $2
         LIMIT 1
         FOR UPDATE`,
        [params.reviewItemId, params.shopId]
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      if (row.version !== params.body.expectedVersion) {
        await client.query('ROLLBACK');
        throw new Error('version_conflict');
      }
      if (row.status !== 'pending' && row.status !== 'in_review') {
        await client.query('ROLLBACK');
        throw new Error('review_item_already_decided');
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE lex_review_items
         SET assigned_to = $3,
             assignment_notes = $4,
             status = CASE WHEN $3::uuid IS NULL THEN 'pending' ELSE 'in_review' END,
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
         RETURNING version`,
        [
          params.reviewItemId,
          params.shopId,
          params.body.assignedTo ?? null,
          params.body.notes ?? null,
        ]
      );

      const decisionId = await insertDecision({
        client,
        reviewItemId: params.reviewItemId,
        shopId: params.shopId,
        entityType: row.entityType,
        entityId: row.entityId,
        decisionType: 'assign',
        oldValue: { assignedTo: row.assignedTo },
        newValue: { assignedTo: params.body.assignedTo ?? null },
        decisionNotes: params.body.notes ?? null,
        decidedBy: params.actorId,
      });
      await client.query('COMMIT');
      return {
        reviewItemId: params.reviewItemId,
        decisionId,
        nextVersion: updated.rows[0]!.version,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function applyLexDecisionSideEffects(params: {
  client: TenantClient;
  shopId: string;
  actorId: string | null;
  body: LexReviewDecisionRequest;
  review: { entityType: string; entityId: string };
}): Promise<{ queueJobId: string | null }> {
  let queueJobId: string | null = null;
  const { client, shopId, actorId, body, review } = params;

  if (body.decisionType === 'lock_translation' && review.entityType === 'translation') {
    await client.query(
      `UPDATE lex_translations
           SET is_locked = true,
               locked_by = $3,
               locked_at = now(),
               updated_at = now()
           WHERE id = $1
             AND (shop_id = $2 OR shop_id IS NULL)`,
      [review.entityId, shopId, actorId]
    );
  }

  if (body.decisionType === 'merge_terms') {
    const targetTermId = resolveMergeTermsTargetTermIdFromNewValue(body.newValue);
    if (!targetTermId) throw new Error('merge_terms_requires_targetTermId');
    await mergeTerms({
      client,
      shopId,
      sourceTermId: review.entityId,
      targetTermId,
    });
  }

  if (body.decisionType === 'split_cluster') {
    const contextIds = uniqueStrings(body.newValue?.['contextIds']);
    if (contextIds.length === 0) throw new Error('split_cluster_requires_contextIds');
    await splitCluster({
      client,
      shopId,
      sourceClusterId: review.entityId,
      selectedContextIds: contextIds,
    });
  }

  if (body.decisionType === 'publish') {
    const publish = await enqueueReviewPublish({
      client,
      shopId,
      entityId: review.entityId,
    });
    queueJobId = publish.queueJobId ?? null;
  }

  return { queueJobId };
}

export async function decideLexReviewItem(params: {
  shopId: string;
  reviewItemId: string;
  body: LexReviewDecisionRequest;
  actorId: string | null;
}): Promise<{
  reviewItemId: string;
  decisionId: string | null;
  nextVersion: number;
  queueJobId: string | null;
  entityType: string;
  entityId: string;
} | null> {
  return await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query<{
        id: string;
        entityType: string;
        entityId: string;
        version: number;
        status: string;
        evidence: Record<string, unknown> | null;
      }>(
        `SELECT id, entity_type AS "entityType", entity_id AS "entityId", version, status, evidence
         FROM lex_review_items
         WHERE id = $1
           AND shop_id = $2
         LIMIT 1
         FOR UPDATE`,
        [params.reviewItemId, params.shopId]
      );
      const review = current.rows[0];
      if (!review) {
        await client.query('ROLLBACK');
        return null;
      }
      if (review.version !== params.body.expectedVersion) {
        await client.query('ROLLBACK');
        throw new Error('version_conflict');
      }
      if (review.status !== 'pending' && review.status !== 'in_review') {
        await client.query('ROLLBACK');
        throw new Error('review_item_already_decided');
      }

      const nextStatus = finalLexReviewItemStatus(params.body.decisionType);

      const { queueJobId } = await applyLexDecisionSideEffects({
        client,
        shopId: params.shopId,
        actorId: params.actorId,
        body: params.body,
        review,
      });

      const updated = await client.query<{ version: number }>(
        `UPDATE lex_review_items
         SET status = $3,
             notes = COALESCE($4, notes),
             version = version + 1,
             resolved_at = now(),
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
         RETURNING version`,
        [params.reviewItemId, params.shopId, nextStatus, params.body.notes ?? null]
      );

      const decisionId = await insertDecision({
        client,
        reviewItemId: params.reviewItemId,
        shopId: params.shopId,
        entityType: review.entityType,
        entityId: review.entityId,
        decisionType: params.body.decisionType,
        oldValue: review.evidence ?? {},
        newValue: toJsonObject(params.body.newValue),
        decisionNotes: params.body.notes ?? null,
        decidedBy: params.actorId,
      });
      await client.query('COMMIT');
      return {
        reviewItemId: params.reviewItemId,
        decisionId,
        nextVersion: updated.rows[0]!.version,
        queueJobId,
        entityType: review.entityType,
        entityId: review.entityId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** Limită pentru o singură cerere bulk (f4-22). */
export const LEX_BULK_REVIEW_DECISION_MAX_ITEMS = 100;

export type LexBulkReviewDecisionInput = Readonly<{
  reviewItemId: string;
  expectedVersion: number;
  decisionType: 'approve' | 'reject';
  notes?: string | null;
}>;

export type LexBulkReviewDecisionSucceeded = Readonly<{
  reviewItemId: string;
  decisionId: string | null;
  nextVersion: number;
  queueJobId: string | null;
  entityType: string;
  entityId: string;
}>;

export type LexBulkReviewDecisionFailed = Readonly<{
  reviewItemId: string;
  code: string;
  message: string;
}>;

/**
 * Approve/reject în masă: fiecare item folosește aceeași logică ca `decideLexReviewItem`
 * (tranzacție separată per item). Eșecurile parțiale sunt raportate în `failed`.
 */
export async function bulkDecideLexReviewItems(params: {
  shopId: string;
  actorId: string | null;
  items: readonly LexBulkReviewDecisionInput[];
}): Promise<{
  succeeded: LexBulkReviewDecisionSucceeded[];
  failed: LexBulkReviewDecisionFailed[];
}> {
  const succeeded: LexBulkReviewDecisionSucceeded[] = [];
  const failed: LexBulkReviewDecisionFailed[] = [];

  for (const item of params.items) {
    try {
      const decision = await decideLexReviewItem({
        shopId: params.shopId,
        reviewItemId: item.reviewItemId,
        body: {
          decisionType: item.decisionType,
          expectedVersion: item.expectedVersion,
          notes: item.notes ?? null,
          newValue: {},
        },
        actorId: params.actorId,
      });
      if (!decision) {
        failed.push({
          reviewItemId: item.reviewItemId,
          code: 'NOT_FOUND',
          message: 'Review item not found',
        });
        continue;
      }
      succeeded.push({
        reviewItemId: item.reviewItemId,
        decisionId: decision.decisionId,
        nextVersion: decision.nextVersion,
        queueJobId: decision.queueJobId,
        entityType: decision.entityType,
        entityId: decision.entityId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let code = 'UNKNOWN';
      if (message === 'version_conflict') code = 'VERSION_CONFLICT';
      else if (message === 'review_item_already_decided') code = 'REVIEW_ITEM_ALREADY_DECIDED';
      failed.push({
        reviewItemId: item.reviewItemId,
        code,
        message,
      });
    }
  }

  return { succeeded, failed };
}
