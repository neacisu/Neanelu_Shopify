import { createHash } from 'node:crypto';

import type { Logger } from '@app/logger';
import type { LexComposeLocalizationJobPayload, LexShardJobPayload } from '@app/types';
import { validateLexComposeLocalizationJobPayload, validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_COMPOSE_LOCALIZATIONS_JOB_NAME,
  LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  LEX_SHARD_PROCESS_JOB_NAME,
} from '../../queue/lex-queues.js';
import {
  advanceLexRunPhaseIfComplete,
  loadLexShard,
  markLexShardActive,
  markLexShardCompleted,
  markLexShardFailed,
  recordLexPhaseEvent,
} from './run-lifecycle.js';
import { saveLexCheckpoint } from './checkpoints.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';
import {
  buildLocalizationContentHash,
  normalizeWhitespace,
  parseShardSourceRecordIds,
} from './pipeline-utils.js';

type FragmentRow = Readonly<{
  id: string;
  sourceTable: string;
  sourceRecordId: string;
  productId: string | null;
  variantId: string | null;
  collectionId: string | null;
  masterProductId: string | null;
  fieldKind: string;
  rawText: string;
  cleanText: string;
}>;

type TranslationRow = Readonly<{
  termId: string;
  translationText: string;
  qualityScore: string | null;
  sourceTexts: string[];
}>;

interface LocalizationDraft {
  entityType: 'product' | 'collection' | 'master_product';
  entityId: string;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  keywords: string[];
  evidenceFragmentIds: string[];
  translatedFragments: number;
  totalFragments: number;
  qualityAccumulator: number;
}

type ReplacementRule = Readonly<{
  sourceText: string;
  targetText: string;
  qualityScore: number;
}>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumberOrZero(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyTranslations(
  text: string,
  rules: ReplacementRule[]
): {
  text: string;
  matchCount: number;
  qualityTotal: number;
  matchedKeywords: string[];
} {
  let output = text;
  let matchCount = 0;
  let qualityTotal = 0;
  const matchedKeywords = new Set<string>();

  for (const rule of rules) {
    const pattern = new RegExp(`\\b${escapeRegex(rule.sourceText)}\\b`, 'giu');
    let localMatches = 0;
    output = output.replace(pattern, () => {
      localMatches += 1;
      return rule.targetText;
    });
    if (localMatches > 0) {
      matchCount += localMatches;
      qualityTotal += rule.qualityScore * localMatches;
      matchedKeywords.add(rule.targetText);
    }
  }

  return {
    text: output,
    matchCount,
    qualityTotal,
    matchedKeywords: [...matchedKeywords],
  };
}

function ensureDraft(
  drafts: Map<string, LocalizationDraft>,
  entityType: 'product' | 'collection' | 'master_product',
  entityId: string
): LocalizationDraft {
  const key = `${entityType}:${entityId}`;
  const existing = drafts.get(key);
  if (existing) return existing;
  const draft: LocalizationDraft = {
    entityType,
    entityId,
    titleText: null,
    descriptionText: null,
    descriptionShort: null,
    seoTitle: null,
    seoDescription: null,
    keywords: [],
    evidenceFragmentIds: [],
    translatedFragments: 0,
    totalFragments: 0,
    qualityAccumulator: 0,
  };
  drafts.set(key, draft);
  return draft;
}

function maybeAppend(base: string | null, nextValue: string | null): string | null {
  if (!nextValue) return base;
  if (!base) return nextValue;
  if (base.includes(nextValue)) return base;
  return `${base}\n\n${nextValue}`;
}

export function startLexComposeLocalizationsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
    workerId: 'lex-compose-localizations-worker',
    processor: async (job) => {
      if (job.name === LEX_COMPOSE_LOCALIZATIONS_JOB_NAME) {
        const payload = job.data as LexComposeLocalizationJobPayload;
        if (!validateLexComposeLocalizationJobPayload(payload)) {
          throw new Error('invalid_lex_compose_localizations_payload');
        }
        return { requested: true, entityType: payload.entityType, targetLang: payload.targetLang };
      }

      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_compose_localizations_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'compose.localizations') {
        throw new Error('invalid_lex_compose_localizations_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'compose.localizations') {
        return { localizationsWritten: 0, localizationIdsTouched: [] };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-compose-localizations-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          const sourceRecordIds = parseShardSourceRecordIds(shard.metadata);
          if (sourceRecordIds.length === 0) {
            return { localizationsWritten: 0, localizationIdsTouched: [] as string[] };
          }

          const fragments = await client.query<FragmentRow>(
            `SELECT
               id,
               source_table AS "sourceTable",
               source_record_id AS "sourceRecordId",
               product_id AS "productId",
               variant_id AS "variantId",
               collection_id AS "collectionId",
               master_product_id AS "masterProductId",
               field_kind AS "fieldKind",
               raw_text AS "rawText",
               clean_text AS "cleanText"
             FROM lex_fragments
             WHERE run_id = $1
               AND shop_id = $2
               AND source_table = $3
               AND source_record_id = ANY($4::uuid[])`,
            [payload.runId, payload.shopId, shard.sourceTable, sourceRecordIds]
          );

          if (fragments.rows.length === 0) {
            return { localizationsWritten: 0, localizationIdsTouched: [] as string[] };
          }

          const productIds = [
            ...new Set(fragments.rows.map((fragment) => fragment.productId).filter(Boolean)),
          ] as string[];
          const productMappings = productIds.length
            ? await client.query<{ externalId: string; masterProductId: string }>(
                `SELECT external_id AS "externalId", product_id AS "masterProductId"
                 FROM prod_channel_mappings
                 WHERE shop_id = $1
                   AND channel = 'shopify'
                   AND external_id = ANY($2::text[])`,
                [payload.shopId, productIds]
              )
            : { rows: [] };
          const productToMaster = new Map(
            productMappings.rows.map((row) => [row.externalId, row.masterProductId])
          );

          const translations = await client.query<TranslationRow>(
            `SELECT
               t.id AS "termId",
               tr.translation_text AS "translationText",
               tr.quality_score AS "qualityScore",
               ARRAY(
                 SELECT DISTINCT variant_text
                 FROM lex_term_variants v
                 WHERE v.term_id = t.id
               ) AS "sourceTexts"
             FROM lex_translations tr
             INNER JOIN lex_terms t
                     ON t.id = tr.term_id
             WHERE (tr.shop_id = $1 OR tr.shop_id IS NULL)
               AND tr.target_lang = 'en'
               AND COALESCE(tr.translation_text, '') <> ''`,
            [payload.shopId]
          );

          const replacementRules = translations.rows
            .flatMap((row) =>
              (row.sourceTexts.length > 0 ? row.sourceTexts : []).map((sourceText) => ({
                sourceText,
                targetText: row.translationText,
                qualityScore: toNumberOrZero(row.qualityScore),
              }))
            )
            .filter((rule) => rule.sourceText.trim().length > 0)
            .sort((left, right) => right.sourceText.length - left.sourceText.length);

          const drafts = new Map<string, LocalizationDraft>();

          for (const fragment of fragments.rows) {
            let entityType: 'product' | 'collection' | 'master_product' | null = null;
            let entityId: string | null = null;
            if (fragment.sourceTable === 'shopify_collections' && fragment.collectionId) {
              entityType = 'collection';
              entityId = fragment.collectionId;
            } else if (fragment.sourceTable === 'prod_master' && fragment.masterProductId) {
              entityType = 'master_product';
              entityId = fragment.masterProductId;
            } else if (fragment.productId && productToMaster.has(fragment.productId)) {
              entityType = 'product';
              entityId = productToMaster.get(fragment.productId) ?? null;
            }
            if (!entityType || !entityId) continue;

            const draft = ensureDraft(drafts, entityType, entityId);
            const translated = applyTranslations(fragment.cleanText, replacementRules);
            const text = normalizeWhitespace(translated.text);

            draft.totalFragments += 1;
            draft.translatedFragments += translated.matchCount > 0 ? 1 : 0;
            draft.qualityAccumulator += translated.qualityTotal;
            draft.evidenceFragmentIds.push(fragment.id);

            if (fragment.fieldKind === 'title') {
              draft.titleText = draft.titleText ?? text;
            } else if (fragment.fieldKind === 'description') {
              draft.descriptionText = maybeAppend(draft.descriptionText, text);
              draft.descriptionShort =
                draft.descriptionShort ??
                (text.length > 500 ? `${text.slice(0, 497).trim()}...` : text);
            } else if (fragment.fieldKind === 'seo_title') {
              draft.seoTitle = draft.seoTitle ?? text;
            } else if (fragment.fieldKind === 'seo_description') {
              draft.seoDescription = draft.seoDescription ?? text;
            }

            if (translated.matchedKeywords.length > 0) {
              draft.keywords.push(...translated.matchedKeywords);
            }
          }

          const localizationIdsTouched: string[] = [];
          for (const draft of drafts.values()) {
            const averageQuality =
              draft.translatedFragments > 0
                ? draft.qualityAccumulator / Math.max(1, draft.translatedFragments)
                : 0;
            const localizationKeywords = [...new Set(draft.keywords)].slice(0, 20);
            const contentHash = buildLocalizationContentHash({
              entityType: draft.entityType,
              entityId: draft.entityId,
              targetLang: 'en',
              titleText: draft.titleText,
              descriptionText: draft.descriptionText,
              descriptionShort: draft.descriptionShort,
              seoTitle: draft.seoTitle,
              seoDescription: draft.seoDescription,
              keywords: localizationKeywords,
            });
            const publicationStatus =
              draft.translatedFragments > 0 && averageQuality >= 0.85 ? 'approved' : 'draft';

            const localization = await client.query<{ id: string }>(
              `INSERT INTO lex_entity_localizations
                 (shop_id, entity_type, entity_id, source_lang, target_lang, title_text, description_text,
                  description_short, seo_title, seo_description, keywords, quality_score, publication_status,
                  content_hash, source_run_id, approved_at, created_at, updated_at)
               VALUES
                 ($1, $2, $3, 'ro', 'en', $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13,
                  CASE WHEN $11 = 'approved' THEN now() ELSE NULL END, now(), now())
               ON CONFLICT (shop_id, entity_type, entity_id, source_lang, target_lang)
               DO UPDATE
                  SET title_text = EXCLUDED.title_text,
                      description_text = EXCLUDED.description_text,
                      description_short = EXCLUDED.description_short,
                      seo_title = EXCLUDED.seo_title,
                      seo_description = EXCLUDED.seo_description,
                      keywords = EXCLUDED.keywords,
                      quality_score = EXCLUDED.quality_score,
                      publication_status = EXCLUDED.publication_status,
                      content_hash = EXCLUDED.content_hash,
                      source_run_id = EXCLUDED.source_run_id,
                      approved_at = CASE WHEN EXCLUDED.publication_status = 'approved' THEN now() ELSE lex_entity_localizations.approved_at END,
                      updated_at = now()
               RETURNING id`,
              [
                payload.shopId,
                draft.entityType,
                draft.entityId,
                draft.titleText,
                draft.descriptionText,
                draft.descriptionShort,
                draft.seoTitle,
                draft.seoDescription,
                localizationKeywords,
                averageQuality.toFixed(4),
                publicationStatus,
                contentHash,
                payload.runId,
              ]
            );

            const localizationId = localization.rows[0]?.id;
            if (!localizationId) continue;
            localizationIdsTouched.push(localizationId);

            await client.query(
              `DELETE FROM lex_entity_localization_evidence
               WHERE shop_id = $1
                 AND localization_id = $2`,
              [payload.shopId, localizationId]
            );

            let order = 0;
            for (const fragmentId of draft.evidenceFragmentIds) {
              await client.query(
                `INSERT INTO lex_entity_localization_evidence
                   (shop_id, localization_id, fragment_id, source_order, evidence_type, metadata, created_at)
                 VALUES
                   ($1, $2, $3, $4, 'fragment', '{}'::jsonb, now())`,
                [payload.shopId, localizationId, fragmentId, order]
              );
              order += 1;
            }

            if (publicationStatus === 'approved') {
              if (draft.entityType === 'collection') {
                const targets = [
                  {
                    targetType: 'shopify_collections.title_en',
                    targetPath: 'title_en',
                    targetValue: draft.titleText,
                  },
                  {
                    targetType: 'shopify_collections.description_en',
                    targetPath: 'description_en',
                    targetValue: draft.descriptionText,
                  },
                ].filter(
                  (target) =>
                    typeof target.targetValue === 'string' && target.targetValue.trim().length > 0
                );

                for (const target of targets) {
                  const targetSnapshotHash = createHash('sha256')
                    .update(
                      JSON.stringify({
                        localizationId,
                        targetType: target.targetType,
                        targetValue: target.targetValue,
                      })
                    )
                    .digest('hex');
                  await client.query(
                    `INSERT INTO lex_publication_targets
                       (localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
                        target_snapshot_hash, status, payload, created_at, updated_at)
                     VALUES
                       ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, now(), now())
                     ON CONFLICT (localization_id, target_type, target_snapshot_hash)
                     DO NOTHING`,
                    [
                      localizationId,
                      payload.shopId,
                      target.targetType,
                      draft.entityId,
                      target.targetPath,
                      `lex-target:${localizationId}:${target.targetType}:${targetSnapshotHash}`,
                      targetSnapshotHash,
                      JSON.stringify({
                        entityType: draft.entityType,
                        entityId: draft.entityId,
                        targetValue: target.targetValue,
                      }),
                    ]
                  );
                }
              }

              if (draft.entityType === 'product') {
                const translationSnapshotHash = createHash('sha256')
                  .update(
                    JSON.stringify({
                      localizationId,
                      targetType: 'prod_translations',
                      titleText: draft.titleText,
                      descriptionText: draft.descriptionText,
                      seoTitle: draft.seoTitle,
                      seoDescription: draft.seoDescription,
                      keywords: localizationKeywords,
                    })
                  )
                  .digest('hex');

                await client.query(
                  `INSERT INTO lex_publication_targets
                     (localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
                      target_snapshot_hash, status, payload, created_at, updated_at)
                   VALUES
                     ($1, $2, 'prod_translations', $3, 'locale:en', $4, $5, 'pending', $6::jsonb, now(), now())
                   ON CONFLICT (localization_id, target_type, target_snapshot_hash)
                   DO NOTHING`,
                  [
                    localizationId,
                    payload.shopId,
                    draft.entityId,
                    `lex-target:${localizationId}:prod_translations:${translationSnapshotHash}`,
                    translationSnapshotHash,
                    JSON.stringify({
                      productId: draft.entityId,
                      locale: 'en',
                      titleText: draft.titleText,
                      descriptionText: draft.descriptionText,
                      descriptionShort: draft.descriptionShort,
                      seoTitle: draft.seoTitle,
                      seoDescription: draft.seoDescription,
                      keywords: localizationKeywords,
                    }),
                  ]
                );

                const semanticsSnapshotHash = createHash('sha256')
                  .update(
                    JSON.stringify({
                      localizationId,
                      targetType: 'prod_semantics',
                      keywords: localizationKeywords,
                      aiSummary: draft.descriptionShort ?? draft.descriptionText,
                    })
                  )
                  .digest('hex');

                await client.query(
                  `INSERT INTO lex_publication_targets
                     (localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
                      target_snapshot_hash, status, payload, created_at, updated_at)
                   VALUES
                     ($1, $2, 'prod_semantics', $3, 'locale:ro', $4, $5, 'pending', $6::jsonb, now(), now())
                   ON CONFLICT (localization_id, target_type, target_snapshot_hash)
                   DO NOTHING`,
                  [
                    localizationId,
                    payload.shopId,
                    draft.entityId,
                    `lex-target:${localizationId}:prod_semantics:${semanticsSnapshotHash}`,
                    semanticsSnapshotHash,
                    JSON.stringify({
                      productId: draft.entityId,
                      locale: 'ro',
                      keywords: localizationKeywords,
                      aiSummary: draft.descriptionShort ?? draft.descriptionText,
                    }),
                  ]
                );
              }
            }
          }

          return {
            localizationsWritten: localizationIdsTouched.length,
            localizationIdsTouched,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-compose-localizations-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'compose.localizations',
            status: 'completed',
            localizationsWritten: result.localizationsWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.localizationIdsTouched.length,
          recordsWritten: result.localizationsWritten,
          metadataPatch: {
            localizationIdsTouched: result.localizationIdsTouched,
          },
        });

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'compose.localizations',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'compose.localizations',
          logger,
        });

        return result;
      } catch (error) {
        await markLexShardFailed({
          shopId: payload.shopId,
          shardId: payload.shardId,
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
        throw error;
      }
    },
  });
}
