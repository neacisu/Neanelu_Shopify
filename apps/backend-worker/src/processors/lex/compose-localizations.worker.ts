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
  buildLexReplacementRulesFromTranslationRows,
  containsComposeDisallowedControlChars,
  extractHtmlTagNamesFromMarkup,
} from './compose-localization-pure.js';
import { maybeAppend } from './pipeline-pure-fns.js';
import {
  buildLocalizationContentHash,
  loadLexShopLangPair,
  normalizeWhitespace,
  parseShardSourceRecordIds,
} from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';
import { applyTranslations, type ReplacementRule } from './compose-apply-translations.js';

type FragmentRow = Readonly<{
  id: string;
  sourceTable: string;
  sourceRecordId: string;
  productId: string | null;
  variantId: string | null;
  collectionId: string | null;
  masterProductId: string | null;
  fieldPath: string;
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

type ComposeEntityKind = 'product' | 'collection' | 'master_product';

interface LocalizationDraft {
  entityType: ComposeEntityKind;
  entityId: string;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  vendorText: string | null;
  productTypeText: string | null;
  tags: string[];
  optionNames: Map<string, string>;
  metafields: Map<string, string>;
  keywords: string[];
  evidenceFragmentIds: string[];
  /** Fragments with at least one translation match (for publication gating). */
  translatedFragments: number;
  totalFragments: number;
  /** Sum of qualityScore × matches per applyTranslations call (weighted by replacement count). */
  qualityAccumulator: number;
  /** Total regex replacement matches across all fragments (denominator for average quality). */
  qualityMatchCount: number;
}

type LoadedLexShard = NonNullable<Awaited<ReturnType<typeof loadLexShard>>>;

type ComposeShardResult = Readonly<{
  localizationsWritten: number;
  localizationIdsTouched: string[];
}>;

/** Opening tag detector aligned with legacy compose guardrail (simple tag names). */
const COMPOSE_SIMPLE_HTML_OPEN_RE = /<[a-z][a-z0-9]*\b[^>]*>/i;

function ensureDraft(
  drafts: Map<string, LocalizationDraft>,
  entityType: ComposeEntityKind,
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
    vendorText: null,
    productTypeText: null,
    tags: [],
    optionNames: new Map(),
    metafields: new Map(),
    keywords: [],
    evidenceFragmentIds: [],
    translatedFragments: 0,
    totalFragments: 0,
    qualityAccumulator: 0,
    qualityMatchCount: 0,
  };
  drafts.set(key, draft);
  return draft;
}

function resolveComposeFragmentsRunId(
  runMeta: Record<string, unknown>,
  defaultRunId: string
): string {
  if (
    runMeta['translate_only'] === true &&
    typeof runMeta['reuse_fragments_run_id'] === 'string' &&
    runMeta['reuse_fragments_run_id'].trim().length > 0
  ) {
    return runMeta['reuse_fragments_run_id'].trim();
  }
  return defaultRunId;
}

function resolveComposeEntityForFragment(
  fragment: FragmentRow,
  productToMaster: ReadonlyMap<string, string>
): { entityType: ComposeEntityKind; entityId: string } | null {
  if (fragment.sourceTable === 'shopify_collections' && fragment.collectionId) {
    return { entityType: 'collection', entityId: fragment.collectionId };
  }
  if (fragment.sourceTable === 'prod_master' && fragment.masterProductId) {
    return { entityType: 'master_product', entityId: fragment.masterProductId };
  }
  if (fragment.productId && productToMaster.has(fragment.productId)) {
    return {
      entityType: 'product',
      entityId: productToMaster.get(fragment.productId)!,
    };
  }
  return null;
}

function shouldSkipComposedFragmentForGuardrails(
  fragment: FragmentRow,
  text: string,
  logger: Logger,
  shopId: string
): boolean {
  const srcLen = fragment.cleanText.trim().length;
  const tgtLen = text.trim().length;
  if (srcLen > 0 && (tgtLen < srcLen * 0.1 || tgtLen > srcLen * 10)) {
    logger.warn(
      { shopId, fragmentId: fragment.id, srcLen, tgtLen },
      'lex_compose_guardrail_length_skip'
    );
    return true;
  }
  if (containsComposeDisallowedControlChars(text)) {
    logger.warn({ shopId, fragmentId: fragment.id }, 'lex_compose_guardrail_non_printable_skip');
    return true;
  }
  if (COMPOSE_SIMPLE_HTML_OPEN_RE.test(fragment.cleanText)) {
    const srcTags = extractHtmlTagNamesFromMarkup(fragment.cleanText);
    const tgtTags = extractHtmlTagNamesFromMarkup(text);
    if (srcTags.length > 0 && tgtTags.length === 0) {
      logger.warn({ shopId, fragmentId: fragment.id }, 'lex_compose_guardrail_html_stripped_skip');
      return true;
    }
  }
  return false;
}

type ComposeFieldKindHandler = (
  draft: LocalizationDraft,
  fragment: FragmentRow,
  text: string
) => void;

const COMPOSE_FIELD_KIND_HANDLERS: Readonly<Record<string, ComposeFieldKindHandler>> = {
  title: (d, _f, t) => {
    d.titleText = d.titleText ?? t;
  },
  description: (d, _f, t) => {
    d.descriptionText = maybeAppend(d.descriptionText, t);
    d.descriptionShort =
      d.descriptionShort ?? (t.length > 500 ? `${t.slice(0, 497).trim()}...` : t);
  },
  seo_title: (d, _f, t) => {
    d.seoTitle = d.seoTitle ?? t;
  },
  seo_description: (d, _f, t) => {
    d.seoDescription = d.seoDescription ?? t;
  },
  vendor: (d, _f, t) => {
    d.vendorText = d.vendorText ?? t;
  },
  product_type: (d, _f, t) => {
    d.productTypeText = d.productTypeText ?? t;
  },
  tags: (d, _f, t) => {
    const parsed = t
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const tag of parsed) {
      if (!d.tags.includes(tag)) d.tags.push(tag);
    }
  },
  option_name: (d, f, t) => {
    d.optionNames.set(f.fieldPath ?? f.id, t);
  },
  metafield: (d, f, t) => {
    d.metafields.set(f.fieldPath ?? f.id, t);
  },
};

function applyTranslatedFragmentToDraft(
  draft: LocalizationDraft,
  fragment: FragmentRow,
  text: string,
  translated: ReturnType<typeof applyTranslations>
): void {
  draft.translatedFragments += translated.matchCount > 0 ? 1 : 0;
  draft.qualityAccumulator += translated.qualityTotal;
  draft.qualityMatchCount += translated.matchCount;
  draft.evidenceFragmentIds.push(fragment.id);

  const runField = COMPOSE_FIELD_KIND_HANDLERS[fragment.fieldKind];
  runField?.(draft, fragment, text);

  if (translated.matchedKeywords.length > 0) {
    draft.keywords.push(...translated.matchedKeywords);
  }
}

function accumulateComposeLocalizationDrafts(params: {
  fragments: readonly FragmentRow[];
  productToMaster: ReadonlyMap<string, string>;
  replacementRules: readonly ReplacementRule[];
  logger: Logger;
  shopId: string;
}): Map<string, LocalizationDraft> {
  const { fragments, productToMaster, replacementRules, logger, shopId } = params;
  const drafts = new Map<string, LocalizationDraft>();

  for (const fragment of fragments) {
    const resolved = resolveComposeEntityForFragment(fragment, productToMaster);
    if (!resolved) continue;

    const draft = ensureDraft(drafts, resolved.entityType, resolved.entityId);
    const translated = applyTranslations(fragment.cleanText, replacementRules);
    const text = normalizeWhitespace(translated.text);
    draft.totalFragments += 1;

    if (shouldSkipComposedFragmentForGuardrails(fragment, text, logger, shopId)) {
      continue;
    }
    applyTranslatedFragmentToDraft(draft, fragment, text, translated);
  }

  return drafts;
}

async function readLocalizationAutoApproveThreshold(
  client: TenantClient,
  shopId: string
): Promise<number> {
  const locThresholdRes = await client.query<{
    localizationAutoApproveThreshold: string | null;
  }>(
    `SELECT localization_auto_approve_threshold::text AS "localizationAutoApproveThreshold"
     FROM lex_shop_settings
     WHERE shop_id = $1
     LIMIT 1`,
    [shopId]
  );
  return Math.max(
    0,
    Math.min(1, Number(locThresholdRes.rows[0]?.localizationAutoApproveThreshold ?? 0.85))
  );
}

async function loadComposeFragmentsRunId(
  client: TenantClient,
  payload: LexShardJobPayload
): Promise<string> {
  const runRow = await client.query<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata
     FROM lex_runs
     WHERE id = $1
       AND shop_id = $2
     LIMIT 1`,
    [payload.runId, payload.shopId]
  );
  const runMeta = runRow.rows[0]?.metadata ?? {};
  return resolveComposeFragmentsRunId(runMeta, payload.runId);
}

async function fetchComposeShardFragments(
  client: TenantClient,
  payload: LexShardJobPayload,
  shard: LoadedLexShard,
  fragmentsRunId: string,
  sourceRecordIds: readonly string[]
): Promise<FragmentRow[]> {
  const fragments = await client.query<FragmentRow>(
    `SELECT
       id,
       source_table AS "sourceTable",
       source_record_id AS "sourceRecordId",
       product_id AS "productId",
       variant_id AS "variantId",
       collection_id AS "collectionId",
       master_product_id AS "masterProductId",
       field_path AS "fieldPath",
       field_kind AS "fieldKind",
       raw_text AS "rawText",
       clean_text AS "cleanText"
     FROM lex_fragments
     WHERE run_id = $1
       AND shop_id = $2
       AND source_table = $3
       AND source_record_id = ANY($4::uuid[])`,
    [fragmentsRunId, payload.shopId, shard.sourceTable, sourceRecordIds]
  );
  return fragments.rows;
}

async function loadProductIdToMasterMap(
  client: TenantClient,
  shopId: string,
  fragments: readonly FragmentRow[]
): Promise<Map<string, string>> {
  const productIds = [...new Set(fragments.map((f) => f.productId).filter(Boolean))] as string[];
  if (productIds.length === 0) {
    return new Map();
  }
  const productMappings = await client.query<{ externalId: string; masterProductId: string }>(
    `SELECT external_id AS "externalId", product_id AS "masterProductId"
     FROM prod_channel_mappings
     WHERE shop_id = $1
       AND channel = 'shopify'
       AND external_id = ANY($2::text[])`,
    [shopId, productIds]
  );
  return new Map(productMappings.rows.map((row) => [row.externalId, row.masterProductId]));
}

async function loadComposeReplacementRules(
  client: TenantClient,
  shopId: string,
  targetLang: string
): Promise<ReplacementRule[]> {
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
       AND tr.target_lang = $2
       AND COALESCE(tr.translation_text, '') <> ''`,
    [shopId, targetLang]
  );
  return buildLexReplacementRulesFromTranslationRows(translations.rows);
}

async function insertLocalizationEvidenceBatches(
  client: TenantClient,
  shopId: string,
  localizationId: string,
  fragmentIds: readonly string[]
): Promise<void> {
  if (fragmentIds.length === 0) return;
  const evBatchSize = 200;
  for (let evOff = 0; evOff < fragmentIds.length; evOff += evBatchSize) {
    const evChunk = fragmentIds.slice(evOff, evOff + evBatchSize);
    const evPlaceholders: string[] = [];
    const evValues: unknown[] = [];
    let evP = 1;
    for (let evIdx = 0; evIdx < evChunk.length; evIdx += 1) {
      evPlaceholders.push(
        `($${evP++}, $${evP++}, $${evP++}, $${evP++}, 'fragment', '{}'::jsonb, now())`
      );
      evValues.push(shopId, localizationId, evChunk[evIdx], evOff + evIdx);
    }
    await client.query(
      `INSERT INTO lex_entity_localization_evidence
         (shop_id, localization_id, fragment_id, source_order, evidence_type, metadata, created_at)
       VALUES ${evPlaceholders.join(', ')}
       ON CONFLICT DO NOTHING`,
      evValues
    );
  }
}

async function insertCollectionPublicationTargets(
  client: TenantClient,
  params: {
    localizationId: string;
    shopId: string;
    draft: LocalizationDraft;
  }
): Promise<void> {
  const { localizationId, shopId, draft } = params;
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
    (target) => typeof target.targetValue === 'string' && target.targetValue.trim().length > 0
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
       ON CONFLICT DO NOTHING`,
      [
        localizationId,
        shopId,
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

async function insertProductPublicationTargets(
  client: TenantClient,
  params: {
    localizationId: string;
    shopId: string;
    targetLang: string;
    draft: LocalizationDraft;
    optionNamesObj: Record<string, string>;
    metafieldsObj: Record<string, string>;
    localizationKeywords: string[];
  }
): Promise<void> {
  const {
    localizationId,
    shopId,
    targetLang,
    draft,
    optionNamesObj,
    metafieldsObj,
    localizationKeywords,
  } = params;

  const translationSnapshotHash = createHash('sha256')
    .update(
      JSON.stringify({
        localizationId,
        targetType: 'prod_translations',
        titleText: draft.titleText,
        descriptionText: draft.descriptionText,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        vendorText: draft.vendorText,
        productTypeText: draft.productTypeText,
        tags: draft.tags,
        optionNames: optionNamesObj,
        metafields: metafieldsObj,
        keywords: localizationKeywords,
      })
    )
    .digest('hex');

  await client.query(
    `INSERT INTO lex_publication_targets
       (localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
        target_snapshot_hash, status, payload, created_at, updated_at)
     VALUES
       ($1, $2, 'prod_translations', $3, $4, $5, $6, 'pending', $7::jsonb, now(), now())
     ON CONFLICT DO NOTHING`,
    [
      localizationId,
      shopId,
      draft.entityId,
      `locale:${targetLang}`,
      `lex-target:${localizationId}:prod_translations:${translationSnapshotHash}`,
      translationSnapshotHash,
      JSON.stringify({
        productId: draft.entityId,
        locale: targetLang,
        titleText: draft.titleText,
        descriptionText: draft.descriptionText,
        descriptionShort: draft.descriptionShort,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        vendorText: draft.vendorText,
        productTypeText: draft.productTypeText,
        tags: draft.tags,
        optionNames: optionNamesObj,
        metafields: metafieldsObj,
        keywords: localizationKeywords,
      }),
    ]
  );

  const semanticsSnapshotHash = createHash('sha256')
    .update(
      JSON.stringify({
        localizationId,
        targetType: 'prod_semantics',
        vendorText: draft.vendorText,
        productTypeText: draft.productTypeText,
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
       ($1, $2, 'prod_semantics', $3, $4, $5, $6, 'pending', $7::jsonb, now(), now())
     ON CONFLICT DO NOTHING`,
    [
      localizationId,
      shopId,
      draft.entityId,
      `locale:${targetLang}`,
      `lex-target:${localizationId}:prod_semantics:${semanticsSnapshotHash}`,
      semanticsSnapshotHash,
      JSON.stringify({
        productId: draft.entityId,
        locale: targetLang,
        vendorText: draft.vendorText,
        productTypeText: draft.productTypeText,
        keywords: localizationKeywords,
        aiSummary: draft.descriptionShort ?? draft.descriptionText,
      }),
    ]
  );
}

async function persistSingleLocalizationDraft(
  client: TenantClient,
  params: {
    draft: LocalizationDraft;
    payload: LexShardJobPayload;
    sourceLang: string;
    targetLang: string;
    localizationAutoApproveThreshold: number;
    localizationIdsTouched: string[];
  }
): Promise<void> {
  const { draft, payload, sourceLang, targetLang, localizationAutoApproveThreshold } = params;

  const averageQuality =
    draft.qualityMatchCount > 0 ? draft.qualityAccumulator / draft.qualityMatchCount : 0;
  const localizationKeywords = [...new Set(draft.keywords)].slice(0, 20);
  const optionNamesObj = Object.fromEntries(draft.optionNames);
  const metafieldsObj = Object.fromEntries(draft.metafields);
  const contentHash = buildLocalizationContentHash({
    entityType: draft.entityType,
    entityId: draft.entityId,
    targetLang,
    titleText: draft.titleText,
    descriptionText: draft.descriptionText,
    descriptionShort: draft.descriptionShort,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    vendorText: draft.vendorText,
    productTypeText: draft.productTypeText,
    tags: draft.tags,
    optionNames: optionNamesObj,
    metafields: metafieldsObj,
    keywords: localizationKeywords,
  });

  const publicationStatus =
    draft.translatedFragments > 0 && averageQuality >= localizationAutoApproveThreshold
      ? 'approved'
      : 'draft';

  const localization = await client.query<{ id: string }>(
    `INSERT INTO lex_entity_localizations
       (shop_id, entity_type, entity_id, source_lang, target_lang, title_text, description_text,
        description_short, seo_title, seo_description, keywords, quality_score, publication_status,
        content_hash, source_run_id, approved_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $13, $14, $15,
        CASE WHEN $13 = 'approved' THEN now() ELSE NULL END, now(), now())
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
      sourceLang,
      targetLang,
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
  if (!localizationId) return;
  params.localizationIdsTouched.push(localizationId);

  await client.query(
    `DELETE FROM lex_entity_localization_evidence
     WHERE shop_id = $1
       AND localization_id = $2`,
    [payload.shopId, localizationId]
  );

  await insertLocalizationEvidenceBatches(
    client,
    payload.shopId,
    localizationId,
    draft.evidenceFragmentIds
  );

  if (publicationStatus !== 'approved') {
    return;
  }

  if (draft.entityType === 'collection') {
    await insertCollectionPublicationTargets(client, {
      localizationId,
      shopId: payload.shopId,
      draft,
    });
  }

  if (draft.entityType === 'product') {
    await insertProductPublicationTargets(client, {
      localizationId,
      shopId: payload.shopId,
      targetLang,
      draft,
      optionNamesObj,
      metafieldsObj,
      localizationKeywords,
    });
  }
}

async function persistAllComposeLocalizationDrafts(
  client: TenantClient,
  params: {
    drafts: ReadonlyMap<string, LocalizationDraft>;
    payload: LexShardJobPayload;
    sourceLang: string;
    targetLang: string;
    localizationAutoApproveThreshold: number;
  }
): Promise<ComposeShardResult> {
  const localizationIdsTouched: string[] = [];
  for (const draft of params.drafts.values()) {
    await persistSingleLocalizationDraft(client, {
      draft,
      payload: params.payload,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      localizationAutoApproveThreshold: params.localizationAutoApproveThreshold,
      localizationIdsTouched,
    });
  }
  return {
    localizationsWritten: localizationIdsTouched.length,
    localizationIdsTouched,
  };
}

async function runComposeLocalizationsDbPhase(
  client: TenantClient,
  ctx: { payload: LexShardJobPayload; shard: LoadedLexShard; logger: Logger }
): Promise<ComposeShardResult> {
  const { payload, shard, logger } = ctx;

  const { sourceLang, targetLang } = await loadLexShopLangPair({
    client,
    shopId: payload.shopId,
  });
  const localizationAutoApproveThreshold = await readLocalizationAutoApproveThreshold(
    client,
    payload.shopId
  );
  const sourceRecordIds = parseShardSourceRecordIds(shard.metadata);
  if (sourceRecordIds.length === 0) {
    return { localizationsWritten: 0, localizationIdsTouched: [] };
  }

  const fragmentsRunId = await loadComposeFragmentsRunId(client, payload);
  const fragmentRows = await fetchComposeShardFragments(
    client,
    payload,
    shard,
    fragmentsRunId,
    sourceRecordIds
  );
  if (fragmentRows.length === 0) {
    return { localizationsWritten: 0, localizationIdsTouched: [] };
  }

  const productToMaster = await loadProductIdToMasterMap(client, payload.shopId, fragmentRows);
  const replacementRules = await loadComposeReplacementRules(client, payload.shopId, targetLang);

  const drafts = accumulateComposeLocalizationDrafts({
    fragments: fragmentRows,
    productToMaster,
    replacementRules,
    logger,
    shopId: payload.shopId,
  });

  return await persistAllComposeLocalizationDrafts(client, {
    drafts,
    payload,
    sourceLang,
    targetLang,
    localizationAutoApproveThreshold,
  });
}

async function finalizeComposeLocalizationsShard(
  payload: LexShardJobPayload,
  result: ComposeShardResult,
  logger: Logger
): Promise<void> {
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
  }).catch(() => undefined);

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
        const result = await withTenantContext(payload.shopId, (client) =>
          runComposeLocalizationsDbPhase(client, { payload, shard, logger })
        );
        await finalizeComposeLocalizationsShard(payload, result, logger);
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
