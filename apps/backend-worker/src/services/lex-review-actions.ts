import { withTenantContext } from '@app/database';
import type { LexAssignReviewRequest, LexReviewDecisionRequest } from '@app/types';

import { enqueueLexPublishJob } from '../queue/lex-queues.js';

interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: TRow[] }>;
}

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
       SELECT cluster_id, $2, similarity_score, is_representative, now()
       FROM lex_sense_cluster_members
       WHERE context_id = $1
       ON CONFLICT (cluster_id, context_id) DO NOTHING`,
      [row.sourceId, row.targetId]
    );
    await params.client.query(
      `UPDATE lex_sense_clusters
       SET representative_context_id = $2,
           updated_at = now()
       WHERE representative_context_id = $1`,
      [row.sourceId, row.targetId]
    );
    await params.client.query(`DELETE FROM lex_sense_cluster_members WHERE context_id = $1`, [
      row.sourceId,
    ]);
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
    `UPDATE lex_translation_candidates
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
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
    `UPDATE lex_attribute_resolution_candidates
     SET term_id = $3,
         updated_at = now()
     WHERE shop_id = $1
       AND term_id = $2`,
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
    `WITH src AS (
       SELECT *
       FROM lex_term_stats
       WHERE shop_id = $1
         AND term_id = $2
       LIMIT 1
     ), tgt AS (
       SELECT *
       FROM lex_term_stats
       WHERE shop_id = $1
         AND term_id = $3
       LIMIT 1
     )
     INSERT INTO lex_term_stats
       (shop_id, term_id, last_run_id, occurrences_total, distinct_fragments, distinct_products, distinct_variants, distinct_collections,
        title_occurrences, description_occurrences, metafield_occurrences, vendor_occurrences, score_global, score_tfidf, score_domain, updated_at)
     SELECT
       $1, $3, COALESCE(tgt.last_run_id, src.last_run_id),
       COALESCE(tgt.occurrences_total, 0) + COALESCE(src.occurrences_total, 0),
       COALESCE(tgt.distinct_fragments, 0) + COALESCE(src.distinct_fragments, 0),
       COALESCE(tgt.distinct_products, 0) + COALESCE(src.distinct_products, 0),
       COALESCE(tgt.distinct_variants, 0) + COALESCE(src.distinct_variants, 0),
       COALESCE(tgt.distinct_collections, 0) + COALESCE(src.distinct_collections, 0),
       COALESCE(tgt.title_occurrences, 0) + COALESCE(src.title_occurrences, 0),
       COALESCE(tgt.description_occurrences, 0) + COALESCE(src.description_occurrences, 0),
       COALESCE(tgt.metafield_occurrences, 0) + COALESCE(src.metafield_occurrences, 0),
       COALESCE(tgt.vendor_occurrences, 0) + COALESCE(src.vendor_occurrences, 0),
       COALESCE(tgt.score_global, src.score_global),
       COALESCE(tgt.score_tfidf, src.score_tfidf),
       COALESCE(tgt.score_domain, src.score_domain),
       now()
     FROM src
     FULL OUTER JOIN tgt ON true
     ON CONFLICT (shop_id, term_id)
     DO UPDATE
        SET occurrences_total = EXCLUDED.occurrences_total,
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
  }>(
    `SELECT
       term_id AS "termId",
       cluster_key AS "clusterKey",
       cluster_method AS "clusterMethod",
       domain_code AS "domainCode",
       taxonomy_id::text AS "taxonomyId",
       label_ro AS "labelRo",
       label_en AS "labelEn",
       description
     FROM lex_sense_clusters
     WHERE id = $1
       AND (shop_id = $2 OR shop_id IS NULL)
     LIMIT 1`,
    [params.sourceClusterId, params.shopId]
  );
  const source = sourceRes.rows[0];
  if (!source) return null;

  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO lex_sense_clusters
       (shop_id, term_id, cluster_key, cluster_method, domain_code, taxonomy_id, label_ro, label_en, description,
        origin_cluster_id, confidence_score, needs_review, is_approved, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '0.7000', true, false, now(), now())
     RETURNING id`,
    [
      params.shopId,
      source.termId,
      `split:${params.sourceClusterId}:${Date.now()}`,
      source.clusterMethod,
      source.domainCode,
      source.taxonomyId,
      source.labelRo,
      source.labelEn,
      source.description,
      params.sourceClusterId,
    ]
  );
  const newClusterId = inserted.rows[0]?.id ?? null;
  if (!newClusterId) return null;

  await params.client.query(
    `INSERT INTO lex_sense_cluster_members (cluster_id, context_id, similarity_score, is_representative, created_at)
     SELECT $2, context_id, similarity_score, is_representative, now()
     FROM lex_sense_cluster_members
     WHERE cluster_id = $1
       AND context_id = ANY($3::uuid[])
     ON CONFLICT (cluster_id, context_id) DO NOTHING`,
    [params.sourceClusterId, newClusterId, params.selectedContextIds]
  );

  await params.client.query(
    `DELETE FROM lex_sense_cluster_members
     WHERE cluster_id = $1
       AND context_id = ANY($2::uuid[])`,
    [params.sourceClusterId, params.selectedContextIds]
  );

  const newRep = await params.client.query<{ contextId: string }>(
    `SELECT context_id AS "contextId"
     FROM lex_sense_cluster_members
     WHERE cluster_id = $1
     ORDER BY is_representative DESC, similarity_score DESC NULLS LAST, created_at ASC
     LIMIT 1`,
    [newClusterId]
  );
  const sourceRep = await params.client.query<{ contextId: string }>(
    `SELECT context_id AS "contextId"
     FROM lex_sense_cluster_members
     WHERE cluster_id = $1
     ORDER BY is_representative DESC, similarity_score DESC NULLS LAST, created_at ASC
     LIMIT 1`,
    [params.sourceClusterId]
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
        assignedTo: string | null;
      }>(
        `SELECT id, entity_type AS "entityType", entity_id AS "entityId", version, assigned_to AS "assignedTo"
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
} | null> {
  return await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const current = await client.query<{
        id: string;
        entityType: string;
        entityId: string;
        version: number;
        evidence: Record<string, unknown> | null;
      }>(
        `SELECT id, entity_type AS "entityType", entity_id AS "entityId", version, evidence
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

      let queueJobId: string | null = null;
      if (params.body.decisionType === 'lock_translation' && review.entityType === 'translation') {
        await client.query(
          `UPDATE lex_translations
           SET is_locked = true,
               locked_by = $3,
               locked_at = now(),
               updated_at = now()
           WHERE id = $1
             AND (shop_id = $2 OR shop_id IS NULL)`,
          [review.entityId, params.shopId, params.actorId]
        );
      }

      if (params.body.decisionType === 'merge_terms') {
        const targetTermId =
          typeof params.body.newValue?.['targetTermId'] === 'string'
            ? params.body.newValue['targetTermId']
            : typeof params.body.newValue?.['survivorTermId'] === 'string'
              ? params.body.newValue['survivorTermId']
              : null;
        if (!targetTermId) throw new Error('merge_terms_requires_targetTermId');
        await mergeTerms({
          client,
          shopId: params.shopId,
          sourceTermId: review.entityId,
          targetTermId,
        });
      }

      if (params.body.decisionType === 'split_cluster') {
        const contextIds = uniqueStrings(params.body.newValue?.['contextIds']);
        if (contextIds.length === 0) throw new Error('split_cluster_requires_contextIds');
        await splitCluster({
          client,
          shopId: params.shopId,
          sourceClusterId: review.entityId,
          selectedContextIds: contextIds,
        });
      }

      if (params.body.decisionType === 'publish') {
        const publish = await enqueueReviewPublish({
          client,
          shopId: params.shopId,
          entityId: review.entityId,
        });
        queueJobId = publish.queueJobId ?? null;
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE lex_review_items
         SET status = CASE WHEN $3 = 'reject' THEN 'rejected' ELSE 'approved' END,
             notes = COALESCE($4, notes),
             version = version + 1,
             resolved_at = now(),
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
         RETURNING version`,
        [params.reviewItemId, params.shopId, params.body.decisionType, params.body.notes ?? null]
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
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
