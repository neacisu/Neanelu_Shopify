import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import type { LexPublicationRollbackStatusDto } from '@app/types';

import { sha256StableJson } from '../processors/lex/pipeline-utils.js';
import { insertLexReviewOpenItemsBatch } from './lex-review-insert.js';

/** Valori `entity_type` în `lex_entity_localizations` (aliniat la tipurile din @app/types). */
export type LexLocalizationEntityType = 'product' | 'collection' | 'master_product';

export interface ApprovedLexLocalization {
  id: string;
  entityType: LexLocalizationEntityType;
  entityId: string;
  sourceLang: string;
  targetLang: string;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  keywords: string[];
  publicationStatus: string;
  qualityScore: number | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function getApprovedLexLocalization(params: {
  shopId: string;
  entityType: LexLocalizationEntityType;
  entityId: string;
  targetLang: string;
}): Promise<ApprovedLexLocalization | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      entityType: LexLocalizationEntityType;
      entityId: string;
      sourceLang: string;
      targetLang: string;
      titleText: string | null;
      descriptionText: string | null;
      descriptionShort: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
      keywords: string[] | null;
      publicationStatus: string;
      qualityScore: string | null;
    }>(
      `SELECT
         id,
         entity_type AS "entityType",
         entity_id AS "entityId",
         source_lang AS "sourceLang",
         target_lang AS "targetLang",
         title_text AS "titleText",
         description_text AS "descriptionText",
         description_short AS "descriptionShort",
         seo_title AS "seoTitle",
         seo_description AS "seoDescription",
         keywords,
         publication_status AS "publicationStatus",
         quality_score AS "qualityScore"
       FROM lex_entity_localizations
       WHERE shop_id = $1
         AND entity_type = $2
         AND entity_id = $3
         AND target_lang = $4
         AND publication_status IN ('approved', 'published')
       ORDER BY approved_at DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
      [params.shopId, params.entityType, params.entityId, params.targetLang]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      keywords: row.keywords ?? [],
      qualityScore: toNumberOrNull(row.qualityScore),
    };
  });
}

export async function publishApprovedCollectionLocalization(params: {
  shopId: string;
  collectionId: string;
  targetLang: string;
}): Promise<ApprovedLexLocalization | null> {
  const localization = await getApprovedLexLocalization({
    shopId: params.shopId,
    entityType: 'collection',
    entityId: params.collectionId,
    targetLang: params.targetLang,
  });

  if (!localization) return null;

  await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const collectionRes = await client.query<{
        titleEn: string | null;
        descriptionEn: string | null;
      }>(
        `SELECT
           title_en AS "titleEn",
           description_en AS "descriptionEn"
         FROM shopify_collections
         WHERE id = $1
           AND shop_id = $2
         LIMIT 1
         FOR UPDATE`,
        [params.collectionId, params.shopId]
      );

      const collection = collectionRes.rows[0];
      if (!collection) {
        await client.query('ROLLBACK');
        return;
      }

      const targetSpecs = [
        {
          targetType: 'shopify_collections.title_en',
          targetPath: 'title_en',
          nextValue: localization.titleText,
          currentValue: collection.titleEn,
        },
        {
          targetType: 'shopify_collections.description_en',
          targetPath: 'description_en',
          nextValue: localization.descriptionText,
          currentValue: collection.descriptionEn,
        },
      ].filter((spec) => typeof spec.nextValue === 'string' && spec.nextValue.trim().length > 0);

      for (const spec of targetSpecs) {
        const previousSnapshot = {
          targetPath: spec.targetPath,
          value: spec.currentValue,
        };
        const publishedSnapshot = {
          targetPath: spec.targetPath,
          value: spec.nextValue,
          localizationId: localization.id,
          qualityScore: localization.qualityScore,
        };
        const targetSnapshotHash = sha256StableJson(publishedSnapshot);
        const idempotencyKey = `lex-publish:${localization.id}:${spec.targetType}:${targetSnapshotHash}`;

        const existingTarget = await client.query<{ id: string }>(
          `SELECT id
           FROM lex_publication_targets
           WHERE localization_id = $1
             AND shop_id = $2
             AND target_type = $3
             AND target_record_id = $4
             AND target_path = $5
           ORDER BY updated_at DESC
           LIMIT 1
           FOR UPDATE`,
          [localization.id, params.shopId, spec.targetType, params.collectionId, spec.targetPath]
        );

        let publicationTargetId = existingTarget.rows[0]?.id ?? null;
        if (!publicationTargetId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO lex_publication_targets
               (localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
                target_snapshot_hash, status, attempt_count, previous_snapshot, published_snapshot, created_at, updated_at)
             VALUES
               ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, $8::jsonb, $9::jsonb, now(), now())
             RETURNING id`,
            [
              localization.id,
              params.shopId,
              spec.targetType,
              params.collectionId,
              spec.targetPath,
              idempotencyKey,
              targetSnapshotHash,
              JSON.stringify(previousSnapshot),
              JSON.stringify(publishedSnapshot),
            ]
          );
          publicationTargetId = inserted.rows[0]?.id ?? null;
        }

        if (!publicationTargetId) continue;

        const action = spec.currentValue === spec.nextValue ? 'noop' : 'update';

        if (spec.currentValue !== spec.nextValue) {
          await client.query(
            spec.targetPath === 'title_en'
              ? `UPDATE shopify_collections
                 SET title_en = $1,
                     updated_at = now()
                 WHERE id = $2
                   AND shop_id = $3`
              : `UPDATE shopify_collections
                 SET description_en = $1,
                     updated_at = now()
                 WHERE id = $2
                   AND shop_id = $3`,
            [spec.nextValue, params.collectionId, params.shopId]
          );
        }

        await client.query(
          `UPDATE lex_publication_targets
           SET status = 'published',
               last_attempt_at = now(),
               attempt_count = COALESCE(attempt_count, 0) + 1,
               error_message = NULL,
               idempotency_key = $2,
               target_snapshot_hash = $3,
               previous_snapshot = $4::jsonb,
               published_snapshot = $5::jsonb,
               updated_at = now()
           WHERE id = $1`,
          [
            publicationTargetId,
            idempotencyKey,
            targetSnapshotHash,
            JSON.stringify(previousSnapshot),
            JSON.stringify(publishedSnapshot),
          ]
        );

        await client.query(
          `INSERT INTO lex_publish_events
             (publication_target_id, shop_id, action, request_payload, response_payload, status, error_message, created_at)
           VALUES
             ($1, $2, $3, $4::jsonb, $5::jsonb, 'published', NULL, now())`,
          [
            publicationTargetId,
            params.shopId,
            action,
            JSON.stringify({
              targetType: spec.targetType,
              targetPath: spec.targetPath,
              previousValue: spec.currentValue,
              nextValue: spec.nextValue,
            }),
            JSON.stringify(publishedSnapshot),
          ]
        );
      }

      await client.query(
        `UPDATE lex_entity_localizations
         SET publication_status = 'published',
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
        [localization.id, params.shopId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { ...localization, publicationStatus: 'published' };
}

type PublicationTargetRow = Readonly<{
  id: string;
  status: string;
  localizationId: string | null;
  targetType: string;
  targetRecordId: string | null;
  targetPath: string | null;
  payload: Record<string, unknown> | null;
  entityType: LexLocalizationEntityType | null;
  entityId: string | null;
  targetLang: string | null;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  keywords: string[] | null;
  qualityScore: string | null;
}>;

async function markPublicationTargetResult(params: {
  client: {
    query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: TRow[] }>;
  };
  publicationTargetId: string;
  shopId: string;
  action: 'insert' | 'update' | 'noop' | 'retry' | 'rollback' | 'skip';
  status: 'published' | 'failed' | 'skipped' | 'orphaned';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  errorMessage?: string | null;
}): Promise<void> {
  await params.client.query(
    `UPDATE lex_publication_targets
     SET status = $2,
         last_attempt_at = now(),
         attempt_count = COALESCE(attempt_count, 0) + 1,
         error_message = $3,
         updated_at = now()
     WHERE id = $1`,
    [params.publicationTargetId, params.status, params.errorMessage ?? null]
  );

  await params.client.query(
    `INSERT INTO lex_publish_events
       (publication_target_id, shop_id, action, request_payload, response_payload, status, error_message, created_at)
     VALUES
       ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, now())`,
    [
      params.publicationTargetId,
      params.shopId,
      params.action,
      JSON.stringify(params.requestPayload),
      JSON.stringify(params.responsePayload),
      params.status,
      params.errorMessage ?? null,
    ]
  );
}

function stableSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

type ProdTranslationSnapshotRow = Readonly<{
  id: string;
  locale: string;
  title: string | null;
  description: string | null;
  descriptionShort: string | null;
  keywords: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  translationSource: string | null;
  qualityScore: string | number | null;
  isApproved: boolean | null;
}>;

type ProdAttrSynonymSnapshotRow = Readonly<{
  id: string;
  definitionId: string;
  synonymText: string;
  locale: string;
  source: string | null;
  confidenceScore: string | number | null;
  isApproved: boolean | null;
}>;

type ProdSemanticsSnapshotRow = Readonly<{
  productId: string;
  locale: string | null;
  keywords: string[] | null;
  keywordsGraph: Record<string, unknown> | null;
  aiSummary: string | null;
}>;

function snapshotNumberOrNull(value: unknown): number | null {
  return toNumberOrNull(value);
}

function buildProdTranslationSnapshot(
  row: ProdTranslationSnapshotRow | null
): Record<string, unknown> {
  if (!row) {
    return {
      exists: false,
      rowId: null,
      locale: 'en',
    };
  }

  return {
    exists: true,
    rowId: row.id,
    locale: row.locale,
    title: row.title,
    description: row.description,
    descriptionShort: row.descriptionShort,
    keywords: row.keywords ?? [],
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    translationSource: row.translationSource,
    qualityScore: snapshotNumberOrNull(row.qualityScore),
    isApproved: row.isApproved === true,
  };
}

function buildProdAttrSynonymSnapshot(
  row: ProdAttrSynonymSnapshotRow | null,
  fallback: { definitionId: string | null; locale: string; synonymText?: string | null }
): Record<string, unknown> {
  if (!row) {
    return {
      exists: false,
      rowId: null,
      definitionId: fallback.definitionId,
      synonymText: fallback.synonymText ?? null,
      locale: fallback.locale,
    };
  }

  return {
    exists: true,
    rowId: row.id,
    definitionId: row.definitionId,
    synonymText: row.synonymText,
    locale: row.locale,
    source: row.source,
    confidenceScore: snapshotNumberOrNull(row.confidenceScore),
    isApproved: row.isApproved === true,
  };
}

function buildProdSemanticsSnapshot(
  row: ProdSemanticsSnapshotRow | null,
  locale: string
): Record<string, unknown> {
  if (!row) {
    return {
      exists: false,
      locale,
    };
  }

  return {
    exists: true,
    productId: row.productId,
    locale: row.locale ?? locale,
    keywords: row.keywords ?? [],
    keywordsGraph: row.keywordsGraph ?? { keywords: row.keywords ?? [] },
    aiSummary: row.aiSummary,
  };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export type LexPublicationRollbackAssessment = Readonly<{
  rollbackable: boolean;
  reason: string | null;
}>;

function assessShopifyCollectionRollback(
  snapshot: Record<string, unknown>
): LexPublicationRollbackAssessment {
  return hasOwn(snapshot, 'value')
    ? { rollbackable: true, reason: null }
    : { rollbackable: false, reason: 'missing_collection_snapshot_value' };
}

function assessProdTranslationsRollback(
  snapshot: Record<string, unknown>
): LexPublicationRollbackAssessment {
  if (snapshot['exists'] === false) {
    return typeof snapshot['locale'] === 'string'
      ? { rollbackable: true, reason: null }
      : { rollbackable: false, reason: 'missing_translation_snapshot_locale' };
  }

  const requiredKeys = [
    'locale',
    'title',
    'description',
    'descriptionShort',
    'keywords',
    'seoTitle',
    'seoDescription',
    'translationSource',
    'qualityScore',
    'isApproved',
  ];

  return requiredKeys.every((key) => hasOwn(snapshot, key))
    ? { rollbackable: true, reason: null }
    : { rollbackable: false, reason: 'incomplete_prod_translations_snapshot' };
}

function assessProdAttrSynonymsRollback(
  snapshot: Record<string, unknown>
): LexPublicationRollbackAssessment {
  if (snapshot['exists'] === false) {
    return typeof snapshot['locale'] === 'string' && typeof snapshot['definitionId'] === 'string'
      ? { rollbackable: true, reason: null }
      : { rollbackable: false, reason: 'missing_attr_synonym_snapshot_identity' };
  }

  return hasOwn(snapshot, 'definitionId') &&
    hasOwn(snapshot, 'synonymText') &&
    hasOwn(snapshot, 'locale')
    ? { rollbackable: true, reason: null }
    : { rollbackable: false, reason: 'incomplete_prod_attr_synonyms_snapshot' };
}

function assessProdSemanticsRollback(
  snapshot: Record<string, unknown>
): LexPublicationRollbackAssessment {
  if (snapshot['exists'] === false) {
    return typeof snapshot['locale'] === 'string'
      ? { rollbackable: true, reason: null }
      : { rollbackable: false, reason: 'missing_prod_semantics_snapshot_locale' };
  }

  const requiredKeys = ['locale', 'keywords', 'keywordsGraph', 'aiSummary'];
  return requiredKeys.every((key) => hasOwn(snapshot, key))
    ? { rollbackable: true, reason: null }
    : { rollbackable: false, reason: 'incomplete_prod_semantics_snapshot' };
}

export function assessLexPublicationRollbackability(params: {
  targetType: string;
  previousSnapshot: Record<string, unknown> | null;
}): LexPublicationRollbackAssessment {
  const snapshot = params.previousSnapshot ?? {};

  if (
    params.targetType === 'shopify_collections.title_en' ||
    params.targetType === 'shopify_collections.description_en'
  ) {
    return assessShopifyCollectionRollback(snapshot);
  }

  if (params.targetType === 'prod_translations') {
    return assessProdTranslationsRollback(snapshot);
  }

  if (params.targetType === 'prod_attr_synonyms') {
    return assessProdAttrSynonymsRollback(snapshot);
  }

  if (params.targetType === 'prod_semantics') {
    return assessProdSemanticsRollback(snapshot);
  }

  return { rollbackable: false, reason: 'unsupported_target_type' };
}

const REPAIRABLE_ROLLBACK_REASONS = new Set<string>([
  'missing_translation_snapshot_locale',
  'missing_attr_synonym_snapshot_identity',
  'missing_prod_semantics_snapshot_locale',
  'incomplete_prod_translations_snapshot',
  'incomplete_prod_attr_synonyms_snapshot',
  'incomplete_prod_semantics_snapshot',
]);

export function getLexPublicationRollbackStatus(params: {
  targetType: string;
  previousSnapshot: Record<string, unknown> | null;
}): LexPublicationRollbackStatusDto {
  const assessment = assessLexPublicationRollbackability(params);
  if (assessment.rollbackable) {
    return {
      rollbackable: true,
      rollbackBlockedReason: null,
      snapshotCompleteness: 'complete',
      needsRepair: false,
    };
  }

  const repairable =
    assessment.reason != null && REPAIRABLE_ROLLBACK_REASONS.has(assessment.reason);
  return {
    rollbackable: false,
    rollbackBlockedReason: assessment.reason,
    snapshotCompleteness: repairable ? 'repairable' : 'blocked',
    needsRepair: assessment.reason !== 'unsupported_target_type',
  };
}

type PublicationSnapshotRepairRow = Readonly<{
  id: string;
  targetType: string;
  targetRecordId: string | null;
  payload: Record<string, unknown> | null;
  previousSnapshot: Record<string, unknown> | null;
  publishedSnapshot: Record<string, unknown> | null;
  latestAction: string | null;
}>;

function deriveProdTranslationsRepairSnapshot(
  row: PublicationSnapshotRepairRow
): Record<string, unknown> {
  const payload = row.payload ?? {};
  const publishedSnapshot = row.publishedSnapshot ?? {};
  const locale =
    (typeof publishedSnapshot['locale'] === 'string' && publishedSnapshot['locale']) ||
    (typeof payload['locale'] === 'string' && payload['locale']) ||
    'en';
  return {
    exists: false,
    rowId: null,
    locale,
  };
}

function deriveProdAttrSynonymsRepairSnapshot(
  row: PublicationSnapshotRepairRow
): Record<string, unknown> | null {
  const payload = row.payload ?? {};
  const publishedSnapshot = row.publishedSnapshot ?? {};
  const definitionId =
    (typeof publishedSnapshot['definitionId'] === 'string' && publishedSnapshot['definitionId']) ||
    (typeof payload['definitionId'] === 'string' && payload['definitionId']) ||
    row.targetRecordId;
  const synonymText =
    (typeof publishedSnapshot['synonymText'] === 'string' && publishedSnapshot['synonymText']) ||
    (typeof payload['synonymText'] === 'string' && payload['synonymText']) ||
    null;
  const locale =
    (typeof publishedSnapshot['locale'] === 'string' && publishedSnapshot['locale']) ||
    (typeof payload['locale'] === 'string' && payload['locale']) ||
    'en';
  if (!definitionId || !synonymText) {
    return null;
  }
  return {
    exists: false,
    rowId: null,
    definitionId,
    synonymText,
    locale,
  };
}

function deriveProdSemanticsRepairSnapshot(
  row: PublicationSnapshotRepairRow
): Record<string, unknown> {
  const payload = row.payload ?? {};
  const publishedSnapshot = row.publishedSnapshot ?? {};
  const locale =
    (typeof publishedSnapshot['locale'] === 'string' && publishedSnapshot['locale']) ||
    (typeof payload['locale'] === 'string' && payload['locale']) ||
    'ro';
  return {
    exists: false,
    locale,
  };
}

function deriveRepairSnapshot(row: PublicationSnapshotRepairRow): Record<string, unknown> | null {
  if (row.latestAction !== 'insert') {
    return null;
  }

  switch (row.targetType) {
    case 'prod_translations':
      return deriveProdTranslationsRepairSnapshot(row);
    case 'prod_attr_synonyms':
      return deriveProdAttrSynonymsRepairSnapshot(row);
    case 'prod_semantics':
      return deriveProdSemanticsRepairSnapshot(row);
    default:
      return null;
  }
}

export async function repairLexPublicationSnapshots(params: {
  shopId: string;
  limit?: number;
}): Promise<{
  scanned: number;
  repaired: number;
  blocked: number;
}> {
  const limit = Number.isFinite(params.limit) ? Math.max(1, Math.floor(params.limit!)) : 250;

  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<PublicationSnapshotRepairRow>(
      `SELECT
         pt.id,
         pt.target_type AS "targetType",
         pt.target_record_id AS "targetRecordId",
         pt.payload,
         pt.previous_snapshot AS "previousSnapshot",
         pt.published_snapshot AS "publishedSnapshot",
         latest.action AS "latestAction"
       FROM lex_publication_targets pt
       LEFT JOIN LATERAL (
         SELECT action
         FROM lex_publish_events pe
         WHERE pe.publication_target_id = pt.id
         ORDER BY pe.created_at DESC
         LIMIT 1
       ) latest ON true
       WHERE pt.shop_id = $1
         AND pt.target_type IN (
           'prod_translations',
           'prod_attr_synonyms',
           'prod_semantics',
           'shopify_collections.title_en',
           'shopify_collections.description_en'
         )
       ORDER BY pt.updated_at DESC
       LIMIT $2`,
      [params.shopId, limit]
    );

    let repaired = 0;
    let blocked = 0;

    for (const row of result.rows) {
      const status = getLexPublicationRollbackStatus({
        targetType: row.targetType,
        previousSnapshot: row.previousSnapshot ?? {},
      });
      if (!status.needsRepair) {
        continue;
      }

      const repairedSnapshot = deriveRepairSnapshot(row);
      if (repairedSnapshot) {
        await client.query(
          `UPDATE lex_publication_targets
           SET previous_snapshot = $2::jsonb,
               error_message = CASE
                 WHEN error_message LIKE 'rollback_blocked:%' THEN NULL
                 ELSE error_message
               END,
               updated_at = now()
           WHERE id = $1`,
          [row.id, JSON.stringify(repairedSnapshot)]
        );
        repaired += 1;
        continue;
      }

      blocked += 1;
    }

    return {
      scanned: result.rows.length,
      repaired,
      blocked,
    };
  });
}

async function insertPublishConflictReview(params: {
  client: {
    query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: TRow[] }>;
  };
  shopId: string;
  entityType: LexLocalizationEntityType;
  entityId: string;
  evidence: Record<string, unknown>;
}): Promise<void> {
  await insertLexReviewOpenItemsBatch({
    client: params.client,
    shopId: params.shopId,
    runId: null,
    rows: [
      {
        entityType: params.entityType,
        entityId: params.entityId,
        reviewReason: 'publish_conflict',
        severity: 'high',
        evidence: params.evidence,
      },
    ],
  });
}

/** Client shape used by publish (tenant transaction; RLS applied). */
export interface LexPublicationPublishClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: TRow[]; rowCount?: number }>;
}

export type LexPublicationTargetOutcome = 'published' | 'failed' | 'skipped';

type PublishLexPublicationBranchArgs = Readonly<{
  client: LexPublicationPublishClient;
  shopId: string;
  target: PublicationTargetRow;
  targetRecordId: string | null;
  payload: Record<string, unknown>;
}> & { readonly logger?: Logger };

type PublishBranchResult =
  | { readonly earlyReturn: true; readonly outcome: LexPublicationTargetOutcome }
  | { readonly earlyReturn: false };

async function publishLexShopifyCollectionPublicationBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { client, shopId, logger, target } = args;
  const targetRecordId = args.targetRecordId!;

  const columnName = target.targetType.endsWith('title_en') ? 'title_en' : 'description_en';
  const nextValue =
    columnName === 'title_en' ? (target.titleText ?? null) : (target.descriptionText ?? null);
  if (!nextValue) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'skipped',
      requestPayload: { columnName },
      responsePayload: { reason: 'missing_localized_value' },
      errorMessage: 'missing_localized_value',
    });
    return { earlyReturn: true, outcome: 'skipped' };
  }

  const current = await client.query<{ value: string | null }>(
    `SELECT ${columnName} AS value
     FROM shopify_collections
     WHERE id = $1
       AND shop_id = $2
     LIMIT 1`,
    [targetRecordId, shopId]
  );
  const previousValue = current.rows[0]?.value ?? null;
  if (!current.rows[0]) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'orphaned',
      requestPayload: { columnName, targetRecordId },
      responsePayload: { reason: 'shopify_collection_missing' },
      errorMessage: 'shopify_collection_missing',
    });
    return { earlyReturn: true, outcome: 'skipped' };
  }

  if (/\[REDACTED_[^\]]+\]/i.test(nextValue)) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'failed',
      requestPayload: { columnName },
      responsePayload: { reason: 'placeholder_in_final_output' },
      errorMessage: 'guardrail_placeholder_in_final_output',
    });
    return { earlyReturn: true, outcome: 'failed' };
  }
  if (nextValue.trim().length === 0) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'failed',
      requestPayload: { columnName },
      responsePayload: { reason: 'target_text_empty' },
      errorMessage: 'guardrail_target_text_empty',
    });
    return { earlyReturn: true, outcome: 'failed' };
  }
  if (previousValue != null && previousValue.length >= 10 && nextValue.length > 0) {
    const maxLen = Math.max(previousValue.length, nextValue.length);
    const lenDiffRatio = Math.abs(previousValue.length - nextValue.length) / maxLen;
    if (lenDiffRatio > 0.8) {
      logger?.warn(
        {
          shopId,
          publicationTargetId: target.id,
          columnName,
          lenDiffRatio: lenDiffRatio.toFixed(3),
        },
        'lex_publish_guardrail_suspect_large_diff'
      );
    }
  }

  let updateRowCount = 0;
  if (previousValue !== nextValue) {
    const updated = await client.query(
      `UPDATE shopify_collections
       SET ${columnName} = $1,
           updated_at = now()
       WHERE id = $2
         AND shop_id = $3`,
      [nextValue, targetRecordId, shopId]
    );
    updateRowCount = updated.rowCount ?? 0;
  }
  if (previousValue !== nextValue && updateRowCount === 0) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'orphaned',
      requestPayload: { columnName, targetRecordId },
      responsePayload: { reason: 'shopify_collection_missing_on_update' },
      errorMessage: 'shopify_collection_missing_on_update',
    });
    return { earlyReturn: true, outcome: 'skipped' };
  }

  await markPublicationTargetResult({
    client,
    publicationTargetId: target.id,
    shopId,
    action: previousValue === nextValue ? 'noop' : 'update',
    status: 'published',
    requestPayload: { columnName, nextValue },
    responsePayload: { previousValue, nextValue },
  });

  await client.query(
    `UPDATE lex_publication_targets
     SET previous_snapshot = $2::jsonb,
         published_snapshot = $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      target.id,
      JSON.stringify(stableSnapshot({ exists: true, columnName, value: previousValue })),
      JSON.stringify(stableSnapshot({ exists: true, columnName, value: nextValue })),
    ]
  );

  return { earlyReturn: false };
}

async function publishLexProdTranslationsPublicationBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { client, shopId, logger, target, payload } = args;
  const targetRecordId = args.targetRecordId!;

  const existing = await client.query<{
    id: string;
    locale: string;
    title: string | null;
    description: string | null;
    descriptionShort: string | null;
    keywords: string[] | null;
    seoTitle: string | null;
    seoDescription: string | null;
    translationSource: string | null;
    qualityScore: string | null;
    isApproved: boolean | null;
  }>(
    `SELECT
       id,
       locale,
       title,
       description,
       description_short AS "descriptionShort",
       keywords,
       seo_title AS "seoTitle",
       seo_description AS "seoDescription",
       translation_source AS "translationSource",
       quality_score AS "qualityScore",
       is_approved AS "isApproved"
     FROM prod_translations
     WHERE product_id = $1
       AND locale = $2
     LIMIT 1
     FOR UPDATE`,
    [targetRecordId, target.targetLang ?? 'en']
  );

  const existingRow = existing.rows[0];
  if (
    existingRow?.translationSource != null &&
    existingRow.translationSource !== 'lex_module' &&
    existingRow.isApproved === true
  ) {
    await insertPublishConflictReview({
      client,
      shopId,
      entityType: target.entityType ?? 'product',
      entityId: target.entityId ?? targetRecordId ?? target.id,
      evidence: {
        targetType: target.targetType,
        targetRecordId,
        translationSource: existingRow.translationSource,
      },
    });
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'failed',
      requestPayload: { targetType: target.targetType, targetRecordId },
      responsePayload: { reason: 'publish_conflict_manual_owned' },
      errorMessage: 'publish_conflict_manual_owned',
    });
    return { earlyReturn: true, outcome: 'failed' };
  }

  const prodTexts = [target.titleText, target.descriptionText].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );
  const placeholderRe = /\[REDACTED_[^\]]+\]/i;
  for (const pt of prodTexts) {
    if (placeholderRe.test(pt)) {
      await markPublicationTargetResult({
        client,
        publicationTargetId: target.id,
        shopId,
        action: 'skip',
        status: 'failed',
        requestPayload: { targetType: target.targetType, targetRecordId },
        responsePayload: { reason: 'placeholder_in_final_output' },
        errorMessage: 'guardrail_placeholder_in_final_output',
      });
      return { earlyReturn: true, outcome: 'failed' };
    }
  }
  if (prodTexts.length === 0) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'failed',
      requestPayload: { targetType: target.targetType, targetRecordId },
      responsePayload: { reason: 'no_content_to_publish' },
      errorMessage: 'guardrail_no_content_to_publish',
    });
    return { earlyReturn: true, outcome: 'failed' };
  }
  if (existingRow && (existingRow.title || existingRow.description)) {
    const oldText = `${existingRow.title ?? ''} ${existingRow.description ?? ''}`.trim();
    const newText = `${target.titleText ?? ''} ${target.descriptionText ?? ''}`.trim();
    if (oldText.length >= 10 && newText.length > 0) {
      const maxLen = Math.max(oldText.length, newText.length);
      const lenDiffRatio = Math.abs(oldText.length - newText.length) / maxLen;
      if (lenDiffRatio > 0.8) {
        logger?.warn(
          {
            shopId,
            publicationTargetId: target.id,
            targetType: target.targetType,
            lenDiffRatio: lenDiffRatio.toFixed(3),
          },
          'lex_publish_guardrail_suspect_large_diff'
        );
      }
    }
  }

  const upserted = await client.query<ProdTranslationSnapshotRow>(
    `INSERT INTO prod_translations
       (product_id, locale, title, description, description_short, keywords, seo_title, seo_description,
        translation_source, quality_score, is_approved, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6::text[], $7, $8, 'lex_module', $9, true, now(), now())
     ON CONFLICT (product_id, locale)
     DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            description_short = EXCLUDED.description_short,
            keywords = EXCLUDED.keywords,
            seo_title = EXCLUDED.seo_title,
            seo_description = EXCLUDED.seo_description,
            translation_source = 'lex_module',
            quality_score = EXCLUDED.quality_score,
            is_approved = true,
            updated_at = now()
     RETURNING
       id,
       locale,
       title,
       description,
       description_short AS "descriptionShort",
       keywords,
       seo_title AS "seoTitle",
       seo_description AS "seoDescription",
       translation_source AS "translationSource",
       quality_score AS "qualityScore",
       is_approved AS "isApproved"`,
    [
      targetRecordId,
      target.targetLang ?? 'en',
      target.titleText,
      target.descriptionText,
      target.descriptionShort,
      target.keywords ?? [],
      target.seoTitle,
      target.seoDescription,
      target.qualityScore ?? null,
    ]
  );
  const upsertedRow = upserted.rows[0] ?? null;

  await client.query(
    `UPDATE lex_publication_targets
     SET previous_snapshot = $2::jsonb,
         published_snapshot = $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      target.id,
      JSON.stringify(stableSnapshot(buildProdTranslationSnapshot(existingRow ?? null))),
      JSON.stringify(stableSnapshot(buildProdTranslationSnapshot(upsertedRow))),
    ]
  );

  await markPublicationTargetResult({
    client,
    publicationTargetId: target.id,
    shopId,
    action: existingRow ? 'update' : 'insert',
    status: 'published',
    requestPayload: payload,
    responsePayload: { locale: target.targetLang ?? 'en' },
  });

  return { earlyReturn: false };
}

async function publishLexProdAttrSynonymsPublicationBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { client, shopId, target, payload } = args;
  const targetRecordId = args.targetRecordId;
  const definitionId =
    typeof payload['definitionId'] === 'string' ? payload['definitionId'] : targetRecordId;
  const synonymText = typeof payload['synonymText'] === 'string' ? payload['synonymText'] : null;
  const locale = typeof payload['locale'] === 'string' ? payload['locale'] : 'en';
  if (!definitionId || !synonymText) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId,
      action: 'skip',
      status: 'skipped',
      requestPayload: payload,
      responsePayload: { reason: 'invalid_attr_synonym_payload' },
      errorMessage: 'invalid_attr_synonym_payload',
    });
    return { earlyReturn: true, outcome: 'skipped' };
  }

  const existing = await client.query<ProdAttrSynonymSnapshotRow>(
    `SELECT id
         , definition_id AS "definitionId"
         , synonym_text AS "synonymText"
         , locale
         , source
         , confidence_score AS "confidenceScore"
         , is_approved AS "isApproved"
     FROM prod_attr_synonyms
     WHERE definition_id = $1
       AND synonym_text = $2
       AND locale = $3
     LIMIT 1`,
    [definitionId, synonymText, locale]
  );
  const existingSynonym = existing.rows[0] ?? null;
  if (!existing.rows[0]?.id) {
    await client.query(
      `INSERT INTO prod_attr_synonyms
         (definition_id, synonym_text, locale, source, confidence_score, is_approved, created_at)
       VALUES
         ($1, $2, $3, 'lex_module', $4, true, now())`,
      [definitionId, synonymText, locale, Number(payload['confidenceScore'] ?? 0.98).toFixed(2)]
    );
  }

  await client.query(
    `UPDATE lex_publication_targets
     SET previous_snapshot = $2::jsonb,
         published_snapshot = $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      target.id,
      JSON.stringify(
        stableSnapshot(
          buildProdAttrSynonymSnapshot(existingSynonym, {
            definitionId,
            synonymText,
            locale,
          })
        )
      ),
      JSON.stringify(
        stableSnapshot(
          buildProdAttrSynonymSnapshot(
            existingSynonym ?? {
              id: '',
              definitionId,
              synonymText,
              locale,
              source: 'lex_module',
              confidenceScore: snapshotNumberOrNull(payload['confidenceScore']) ?? 0.98,
              isApproved: true,
            },
            { definitionId, synonymText, locale }
          )
        )
      ),
    ]
  );

  await markPublicationTargetResult({
    client,
    publicationTargetId: target.id,
    shopId,
    action: existing.rows[0]?.id ? 'noop' : 'insert',
    status: 'published',
    requestPayload: payload,
    responsePayload: { definitionId, synonymText, locale },
  });

  return { earlyReturn: false };
}

async function publishLexProdSemanticsPublicationBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { client, shopId, target, payload } = args;
  const targetRecordId = args.targetRecordId!;

  const locale = typeof payload['locale'] === 'string' ? payload['locale'] : 'ro';
  const keywords = Array.isArray(payload['keywords'])
    ? payload['keywords'].filter((value): value is string => typeof value === 'string')
    : [];
  const aiSummary =
    typeof payload['aiSummary'] === 'string'
      ? payload['aiSummary']
      : (target.descriptionShort ?? target.descriptionText);

  const existing = await client.query<{ productId: string }>(
    `SELECT product_id AS "productId"
     FROM prod_semantics
     WHERE product_id = $1
     LIMIT 1`,
    [targetRecordId]
  );
  const previousState = existing.rows[0]?.productId
    ? await client.query<{
        productId: string;
        locale: string | null;
        keywords: string[] | null;
        keywordsGraph: Record<string, unknown> | null;
        aiSummary: string | null;
      }>(
        `SELECT
           product_id AS "productId",
           locale,
           keywords,
           keywords_graph AS "keywordsGraph",
           ai_summary AS "aiSummary"
         FROM prod_semantics
         WHERE product_id = $1
         LIMIT 1`,
        [targetRecordId]
      )
    : { rows: [] };

  if (existing.rows[0]?.productId) {
    await client.query(
      `UPDATE prod_semantics
       SET keywords = $2::text[],
           keywords_graph = $3::jsonb,
           ai_summary = $4,
           updated_at = now()
       WHERE product_id = $1`,
      [targetRecordId, keywords, JSON.stringify({ keywords }), aiSummary ?? null]
    );
  } else {
    const master = await client.query<{ canonicalTitle: string | null }>(
      `SELECT canonical_title AS "canonicalTitle"
       FROM prod_master
       WHERE id = $1
       LIMIT 1`,
      [targetRecordId]
    );
    await client.query(
      `INSERT INTO prod_semantics
         (product_id, title_master, description_master, description_short, ai_summary,
          keywords, keywords_graph, locale, updated_at)
       VALUES
         ($1, $2, NULL, $3, $4, $5::text[], $6::jsonb, $7, now())`,
      [
        targetRecordId,
        master.rows[0]?.canonicalTitle ?? '',
        aiSummary ? aiSummary.slice(0, 500) : null,
        aiSummary ?? null,
        keywords,
        JSON.stringify({ keywords }),
        locale,
      ]
    );
  }

  await client.query(
    `UPDATE lex_publication_targets
     SET previous_snapshot = $2::jsonb,
         published_snapshot = $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      target.id,
      JSON.stringify(
        stableSnapshot(buildProdSemanticsSnapshot(previousState.rows[0] ?? null, locale))
      ),
      JSON.stringify(
        stableSnapshot(
          buildProdSemanticsSnapshot(
            {
              productId: String(targetRecordId),
              locale,
              keywords,
              keywordsGraph: { keywords },
              aiSummary: aiSummary ?? null,
            },
            locale
          )
        )
      ),
    ]
  );

  await markPublicationTargetResult({
    client,
    publicationTargetId: target.id,
    shopId,
    action: existing.rows[0]?.productId ? 'update' : 'insert',
    status: 'published',
    requestPayload: payload,
    responsePayload: { locale, keywordsCount: keywords.length },
  });

  return { earlyReturn: false };
}

async function publishLexUnsupportedPublicationTargetBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { client, shopId, target, payload } = args;
  await markPublicationTargetResult({
    client,
    publicationTargetId: target.id,
    shopId,
    action: 'skip',
    status: 'skipped',
    requestPayload: payload,
    responsePayload: { reason: 'publish_target_not_supported_yet' },
    errorMessage: 'publish_target_not_supported_yet',
  });
  return { earlyReturn: true, outcome: 'skipped' };
}

async function runLexPublicationTargetPublishBranch(
  args: PublishLexPublicationBranchArgs
): Promise<PublishBranchResult> {
  const { target } = args;
  if (
    target.targetType === 'shopify_collections.title_en' ||
    target.targetType === 'shopify_collections.description_en'
  ) {
    return await publishLexShopifyCollectionPublicationBranch(args);
  }
  if (target.targetType === 'prod_translations') {
    return await publishLexProdTranslationsPublicationBranch(args);
  }
  if (target.targetType === 'prod_attr_synonyms') {
    return await publishLexProdAttrSynonymsPublicationBranch(args);
  }
  if (target.targetType === 'prod_semantics') {
    return await publishLexProdSemanticsPublicationBranch(args);
  }
  return await publishLexUnsupportedPublicationTargetBranch(args);
}

/**
 * Runs publish for one target inside an existing tenant transaction (e.g. batched with SAVEPOINTs).
 * Preserves per-target conflict checks and the same semantics as {@link publishLexPublicationTarget}.
 */
export async function publishLexPublicationTargetWithClient(
  client: LexPublicationPublishClient,
  params: { shopId: string; publicationTargetId: string; logger?: Logger }
): Promise<LexPublicationTargetOutcome> {
  const targetRes = await client.query<PublicationTargetRow>(
    `SELECT
         pt.id,
         pt.status,
         pt.localization_id AS "localizationId",
         pt.target_type AS "targetType",
         pt.target_record_id AS "targetRecordId",
         pt.target_path AS "targetPath",
         pt.payload,
         l.entity_type AS "entityType",
         l.entity_id AS "entityId",
         l.target_lang AS "targetLang",
         l.title_text AS "titleText",
         l.description_text AS "descriptionText",
         l.description_short AS "descriptionShort",
         l.seo_title AS "seoTitle",
         l.seo_description AS "seoDescription",
         l.keywords,
         l.quality_score AS "qualityScore"
       FROM lex_publication_targets pt
       LEFT JOIN lex_entity_localizations l
              ON l.id = pt.localization_id
       WHERE pt.id = $1
         AND pt.shop_id = $2
       LIMIT 1
       FOR UPDATE`,
    [params.publicationTargetId, params.shopId]
  );

  const target = targetRes.rows[0];
  if (!target) return 'skipped';
  if (target.status !== 'pending') {
    return 'skipped';
  }

  const payload = target.payload ?? {};
  const targetRecordId = target.targetRecordId ?? target.entityId ?? null;
  if (!targetRecordId && target.targetType !== 'prod_attr_synonyms') {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId: params.shopId,
      action: 'skip',
      status: 'skipped',
      requestPayload: { reason: 'missing_target_record' },
      responsePayload: {},
      errorMessage: 'missing_target_record',
    });
    return 'skipped';
  }

  try {
    const branch = await runLexPublicationTargetPublishBranch(
      params.logger === undefined
        ? { client, shopId: params.shopId, target, targetRecordId, payload }
        : {
            client,
            shopId: params.shopId,
            logger: params.logger,
            target,
            targetRecordId,
            payload,
          }
    );
    if (branch.earlyReturn) {
      return branch.outcome;
    }

    if (target.localizationId) {
      await client.query(
        `UPDATE lex_entity_localizations
         SET publication_status = 'published',
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
        [target.localizationId, params.shopId]
      );
    }

    return 'published';
  } catch (error) {
    await markPublicationTargetResult({
      client,
      publicationTargetId: target.id,
      shopId: params.shopId,
      action: 'retry',
      status: 'failed',
      requestPayload: payload,
      responsePayload: {},
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

export async function publishLexPublicationTarget(params: {
  shopId: string;
  publicationTargetId: string;
}): Promise<LexPublicationTargetOutcome> {
  return await withTenantContext(params.shopId, async (client) =>
    publishLexPublicationTargetWithClient(client, params)
  );
}

/** Use after ROLLBACK TO SAVEPOINT when {@link publishLexPublicationTargetWithClient} threw unexpectedly. */
export async function markLexPublicationTargetUnexpectedFailure(params: {
  client: LexPublicationPublishClient;
  shopId: string;
  publicationTargetId: string;
  error: unknown;
}): Promise<void> {
  await markPublicationTargetResult({
    client: params.client,
    publicationTargetId: params.publicationTargetId,
    shopId: params.shopId,
    action: 'retry',
    status: 'failed',
    requestPayload: {},
    responsePayload: { reason: 'publish_batch_unexpected_error' },
    errorMessage: params.error instanceof Error ? params.error.message : String(params.error),
  });
}

export type LexPublicationRollbackOutcome = 'rolled_back' | 'skipped' | 'failed';

interface LexPublicationRollbackTargetRow {
  readonly id: string;
  readonly targetType: string;
  readonly targetRecordId: string | null;
  readonly targetPath: string | null;
  readonly previousSnapshot: Record<string, unknown> | null;
  readonly payload: Record<string, unknown> | null;
}

type RollbackLexPublicationBranchContext = Readonly<{
  client: LexPublicationPublishClient;
  shopId: string;
  target: LexPublicationRollbackTargetRow;
  previous: Record<string, unknown>;
  payload: Record<string, unknown>;
}>;

async function executeLexShopifyCollectionRollback(
  ctx: RollbackLexPublicationBranchContext
): Promise<void> {
  const { client, shopId, target, previous } = ctx;
  const columnName = target.targetType.endsWith('title_en') ? 'title_en' : 'description_en';
  await client.query(
    `UPDATE shopify_collections
     SET ${columnName} = $1,
         updated_at = now()
     WHERE id = $2
       AND shop_id = $3`,
    [previous['value'] ?? null, target.targetRecordId, shopId]
  );
}

async function executeLexProdTranslationsRollback(
  ctx: RollbackLexPublicationBranchContext
): Promise<void> {
  const { client, target, previous, payload } = ctx;
  if (previous['exists'] === false) {
    await client.query(
      `DELETE FROM prod_translations
       WHERE product_id = $1
         AND locale = $2
         AND translation_source = 'lex_module'`,
      [target.targetRecordId, previous['locale'] ?? payload['locale'] ?? 'en']
    );
    return;
  }
  await client.query(
    `INSERT INTO prod_translations
       (id, product_id, locale, title, description, description_short, keywords, seo_title, seo_description,
        translation_source, quality_score, is_approved, created_at, updated_at)
     VALUES
       (COALESCE($1::uuid, uuidv7()), $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, now(), now())
     ON CONFLICT (product_id, locale)
     DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            description_short = EXCLUDED.description_short,
            keywords = EXCLUDED.keywords,
            seo_title = EXCLUDED.seo_title,
            seo_description = EXCLUDED.seo_description,
            translation_source = EXCLUDED.translation_source,
            quality_score = EXCLUDED.quality_score,
            is_approved = EXCLUDED.is_approved,
            updated_at = now()`,
    [
      typeof previous['rowId'] === 'string' ? previous['rowId'] : null,
      target.targetRecordId,
      previous['locale'] ?? 'en',
      previous['title'] ?? null,
      previous['description'] ?? null,
      previous['descriptionShort'] ?? null,
      Array.isArray(previous['keywords']) ? previous['keywords'] : [],
      previous['seoTitle'] ?? null,
      previous['seoDescription'] ?? null,
      previous['translationSource'] ?? null,
      previous['qualityScore'] ?? null,
      previous['isApproved'] === true,
    ]
  );
}

async function executeLexProdAttrSynonymsRollback(
  ctx: RollbackLexPublicationBranchContext
): Promise<void> {
  const { client, target, previous, payload } = ctx;
  if (previous['exists'] === false) {
    await client.query(
      `DELETE FROM prod_attr_synonyms
       WHERE definition_id = $1
         AND synonym_text = $2
         AND locale = $3
         AND source = 'lex_module'`,
      [
        previous['definitionId'] ?? payload['definitionId'] ?? target.targetRecordId,
        previous['synonymText'] ?? payload['synonymText'] ?? null,
        previous['locale'] ?? payload['locale'] ?? 'en',
      ]
    );
    return;
  }
  await client.query(
    `INSERT INTO prod_attr_synonyms
       (id, definition_id, synonym_text, locale, source, confidence_score, is_approved, created_at)
     SELECT
       COALESCE($1::uuid, uuidv7()), $2, $3, $4, $5, $6, $7, now()
     WHERE NOT EXISTS (
       SELECT 1
       FROM prod_attr_synonyms
       WHERE definition_id = $2
         AND synonym_text = $3
         AND locale = $4
     )`,
    [
      typeof previous['rowId'] === 'string' ? previous['rowId'] : null,
      previous['definitionId'] ?? payload['definitionId'] ?? target.targetRecordId,
      previous['synonymText'] ?? payload['synonymText'] ?? null,
      previous['locale'] ?? payload['locale'] ?? 'en',
      previous['source'] ?? 'manual',
      previous['confidenceScore'] ?? 1,
      previous['isApproved'] === true,
    ]
  );
}

async function executeLexProdSemanticsRollback(
  ctx: RollbackLexPublicationBranchContext
): Promise<void> {
  const { client, target, previous, payload } = ctx;
  if (previous['exists'] === false) {
    await client.query(
      `DELETE FROM prod_semantics
       WHERE product_id = $1
         AND locale = $2`,
      [target.targetRecordId, payload['locale'] ?? 'ro']
    );
    return;
  }
  await client.query(
    `UPDATE prod_semantics
     SET keywords = $2::text[],
         keywords_graph = $3::jsonb,
         ai_summary = $4,
         locale = $5,
         updated_at = now()
     WHERE product_id = $1`,
    [
      target.targetRecordId,
      Array.isArray(previous['keywords']) ? previous['keywords'] : [],
      JSON.stringify(previous['keywordsGraph'] ?? { keywords: [] }),
      typeof previous['aiSummary'] === 'string' ? previous['aiSummary'] : null,
      typeof previous['locale'] === 'string' ? previous['locale'] : 'ro',
    ]
  );
}

async function runLexPublicationTargetRollbackBranch(
  ctx: RollbackLexPublicationBranchContext
): Promise<'executed' | 'unsupported'> {
  const { target } = ctx;
  if (
    target.targetType === 'shopify_collections.title_en' ||
    target.targetType === 'shopify_collections.description_en'
  ) {
    await executeLexShopifyCollectionRollback(ctx);
    return 'executed';
  }
  if (target.targetType === 'prod_translations') {
    await executeLexProdTranslationsRollback(ctx);
    return 'executed';
  }
  if (target.targetType === 'prod_attr_synonyms') {
    await executeLexProdAttrSynonymsRollback(ctx);
    return 'executed';
  }
  if (target.targetType === 'prod_semantics') {
    await executeLexProdSemanticsRollback(ctx);
    return 'executed';
  }
  return 'unsupported';
}

export async function rollbackLexPublicationTarget(params: {
  shopId: string;
  publicationTargetId: string;
}): Promise<LexPublicationRollbackOutcome> {
  return await withTenantContext(params.shopId, async (client) => {
    const targetRes = await client.query<LexPublicationRollbackTargetRow>(
      `SELECT
         id,
         target_type AS "targetType",
         target_record_id AS "targetRecordId",
         target_path AS "targetPath",
         previous_snapshot AS "previousSnapshot",
         payload
       FROM lex_publication_targets
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1
       FOR UPDATE`,
      [params.publicationTargetId, params.shopId]
    );

    const target = targetRes.rows[0];
    if (!target) return 'skipped';

    const previous = target.previousSnapshot ?? {};
    const payload = target.payload ?? {};
    const rollbackAssessment = assessLexPublicationRollbackability({
      targetType: target.targetType,
      previousSnapshot: previous,
    });

    if (!rollbackAssessment.rollbackable) {
      await markPublicationTargetResult({
        client,
        publicationTargetId: target.id,
        shopId: params.shopId,
        action: 'rollback',
        status: 'failed',
        requestPayload: { targetType: target.targetType },
        responsePayload: { reason: rollbackAssessment.reason },
        errorMessage: rollbackAssessment.reason ?? 'rollback_blocked',
      });
      return 'failed';
    }

    try {
      const rollbackBranch = await runLexPublicationTargetRollbackBranch({
        client,
        shopId: params.shopId,
        target,
        previous,
        payload,
      });
      if (rollbackBranch === 'unsupported') {
        return 'skipped';
      }

      await client.query(
        `UPDATE lex_publication_targets
         SET status = 'rolled_back',
             updated_at = now()
         WHERE id = $1`,
        [target.id]
      );

      await markPublicationTargetResult({
        client,
        publicationTargetId: target.id,
        shopId: params.shopId,
        action: 'rollback',
        status: 'published',
        requestPayload: { targetType: target.targetType },
        responsePayload: { previousSnapshot: previous },
      });
      return 'rolled_back';
    } catch (error) {
      await markPublicationTargetResult({
        client,
        publicationTargetId: target.id,
        shopId: params.shopId,
        action: 'rollback',
        status: 'failed',
        requestPayload: { targetType: target.targetType },
        responsePayload: {},
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  });
}
