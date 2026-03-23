import { createHash } from 'node:crypto';

import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { LexRunRequestedJobPayload, LexShardJobPayload } from '@app/types';
import { validateLexRunRequestedJobPayload, validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { scanLexInput } from '../../services/lex-guardrails.js';

import {
  enqueueLexShardJob,
  LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  LEX_RUN_REQUESTED_JOB_NAME,
  LEX_SHARD_PROCESS_JOB_NAME,
  LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
} from '../../queue/lex-queues.js';
import { lexRunTypePriority, lexShardBatchPriority } from '../../queue/lex-run-priorities.js';
import {
  advanceLexRunPhaseIfComplete,
  markLexRunFailed,
  markLexRunStarted,
  markLexShardActive,
  markLexShardCompleted,
  markLexShardFailed,
  recordLexPhaseEvent,
  loadLexShard,
} from './run-lifecycle.js';
import { saveLexCheckpoint } from './checkpoints.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';
import { loadLexShopLangPair } from './pipeline-utils.js';
import {
  rawTextContainsLikelyHtmlTag,
  shouldPreserveHtmlField,
  stripHtml,
} from './pipeline-pure-fns.js';
import type { TenantClient } from './pipeline-types.js';

type SourceTableName =
  | 'shopify_products'
  | 'shopify_variants'
  | 'shopify_collections'
  | 'prod_master';

type SourceWindowRow = Readonly<{
  id: string;
  updatedAt: string;
}>;

type FragmentInput = Readonly<{
  sourceTable: SourceTableName;
  sourceRecordId: string;
  sourceGid?: string | null;
  productId?: string | null;
  variantId?: string | null;
  collectionId?: string | null;
  masterProductId?: string | null;
  fieldPath: string;
  fieldKind: string;
  rawText: string;
  vendorHint?: string | null;
  productTypeHint?: string | null;
  categoryHint?: string | null;
}>;

type FragmentRowBase = Omit<FragmentInput, 'fieldPath' | 'fieldKind' | 'rawText'>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

function canonicalizeText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function tokenCount(value: string): number {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function pushStringFragment(
  fragments: FragmentInput[],
  base: FragmentRowBase,
  fieldPath: string,
  fieldKind: string,
  rawValue: unknown
): void {
  if (typeof rawValue === 'string' && rawValue.trim()) {
    fragments.push({ ...base, fieldPath, fieldKind, rawText: rawValue });
  }
}

function metafieldFragmentsForKey(key: string, raw: unknown): FragmentInput[] {
  const out: FragmentInput[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    out.push({
      sourceTable: 'shopify_products',
      sourceRecordId: '',
      fieldPath: `metafields.${key}`,
      fieldKind: 'metafield',
      rawText: raw,
    });
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  for (const [nestedKey, nestedValue] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof nestedValue === 'string' && nestedValue.trim()) {
      out.push({
        sourceTable: 'shopify_products',
        sourceRecordId: '',
        fieldPath: `metafields.${key}.${nestedKey}`,
        fieldKind: 'metafield',
        rawText: nestedValue,
      });
    }
  }
  return out;
}

function normalizeMetafields(value: unknown): FragmentInput[] {
  if (!value || typeof value !== 'object') return [];
  const out: FragmentInput[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out.push(...metafieldFragmentsForKey(key, raw));
  }
  return out;
}

async function loadSourceWindow(params: {
  client: TenantClient;
  shopId: string;
  sourceTable: SourceTableName;
  shardSize: number;
  afterUpdatedAt?: string | null;
  afterId?: string | null;
  watermarkUpdatedAt?: string | null;
  watermarkId?: string | null;
}): Promise<SourceWindowRow[]> {
  const hasShopScope = params.sourceTable !== 'prod_master';
  const baseParams: unknown[] = hasShopScope ? [params.shopId] : [];
  let idx = baseParams.length + 1;
  let lowerBoundSql = '';

  if (params.watermarkUpdatedAt) {
    lowerBoundSql += ` AND (updated_at > $${idx}::timestamptz`;
    baseParams.push(params.watermarkUpdatedAt);
    idx += 1;
    if (params.watermarkId) {
      lowerBoundSql += ` OR (updated_at = $${idx - 1}::timestamptz AND id > $${idx}::uuid)`;
      baseParams.push(params.watermarkId);
      idx += 1;
    }
    lowerBoundSql += ')';
  }

  if (params.afterUpdatedAt) {
    lowerBoundSql += ` AND (updated_at > $${idx}::timestamptz OR (updated_at = $${idx}::timestamptz AND id > $${idx + 1}::uuid))`;
    baseParams.push(
      params.afterUpdatedAt,
      params.afterId ?? '00000000-0000-0000-0000-000000000000'
    );
    idx += 2;
  }

  const sql = `SELECT id, updated_at::text AS "updatedAt"
    FROM ${params.sourceTable}
    WHERE ${hasShopScope ? 'shop_id = $1' : '1 = 1'}
      ${lowerBoundSql}
    ORDER BY updated_at ASC, id ASC
    LIMIT $${idx}`;
  baseParams.push(params.shardSize);

  const result = await params.client.query<SourceWindowRow>(sql, baseParams);
  return result.rows;
}

async function fetchShardSourceRows(params: {
  client: TenantClient;
  shopId: string;
  sourceTable: SourceTableName;
  metadata: Record<string, unknown>;
}): Promise<Record<string, unknown>[]> {
  const startUpdatedAt =
    typeof params.metadata['windowStartUpdatedAt'] === 'string'
      ? params.metadata['windowStartUpdatedAt']
      : null;
  const startId =
    typeof params.metadata['windowStartId'] === 'string' ? params.metadata['windowStartId'] : null;
  const endUpdatedAt =
    typeof params.metadata['windowEndUpdatedAt'] === 'string'
      ? params.metadata['windowEndUpdatedAt']
      : null;
  const endId =
    typeof params.metadata['windowEndId'] === 'string' ? params.metadata['windowEndId'] : null;

  if (!startUpdatedAt || !startId || !endUpdatedAt || !endId) {
    return [];
  }

  const hasShopScope = params.sourceTable !== 'prod_master';
  const result = await params.client.query<Record<string, unknown>>(
    `SELECT *
     FROM ${params.sourceTable}
     WHERE ${hasShopScope ? 'shop_id = $1 AND' : ''}
       (updated_at > $${hasShopScope ? 2 : 1}::timestamptz OR (updated_at = $${hasShopScope ? 2 : 1}::timestamptz AND id >= $${hasShopScope ? 3 : 2}::uuid))
       AND (updated_at < $${hasShopScope ? 4 : 3}::timestamptz OR (updated_at = $${hasShopScope ? 4 : 3}::timestamptz AND id <= $${hasShopScope ? 5 : 4}::uuid))
     ORDER BY updated_at ASC, id ASC`,
    hasShopScope
      ? [params.shopId, startUpdatedAt, startId, endUpdatedAt, endId]
      : [startUpdatedAt, startId, endUpdatedAt, endId]
  );

  return result.rows;
}

function collectProductFragmentsFromRow(id: string, row: Record<string, unknown>): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_products',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    productId: id,
    vendorHint: typeof row['vendor'] === 'string' ? row['vendor'] : null,
    productTypeHint: typeof row['product_type'] === 'string' ? row['product_type'] : null,
    categoryHint: typeof row['category_id'] === 'string' ? row['category_id'] : null,
  };

  pushStringFragment(fragments, base, 'title', 'title', row['title']);
  pushStringFragment(fragments, base, 'description', 'description', row['description']);
  pushStringFragment(fragments, base, 'description_html', 'description', row['description_html']);
  pushStringFragment(fragments, base, 'vendor', 'vendor', row['vendor']);
  pushStringFragment(fragments, base, 'product_type', 'product_type', row['product_type']);

  const tags = Array.isArray(row['tags'])
    ? row['tags'].filter((tag) => typeof tag === 'string')
    : [];
  for (const tag of tags) {
    pushStringFragment(fragments, base, 'tags[]', 'tag', tag);
  }

  if (row['seo'] && typeof row['seo'] === 'object') {
    const seo = row['seo'] as Record<string, unknown>;
    pushStringFragment(fragments, base, 'seo.title', 'seo_title', seo['title']);
    pushStringFragment(fragments, base, 'seo.description', 'seo_description', seo['description']);
  }

  const metafieldFragments = normalizeMetafields(row['metafields']).map((fragment) => ({
    ...fragment,
    ...base,
  }));
  fragments.push(...metafieldFragments);

  return fragments;
}

function collectVariantFragmentsFromRow(id: string, row: Record<string, unknown>): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_variants',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    productId: typeof row['product_id'] === 'string' ? row['product_id'] : null,
    variantId: id,
  };

  pushStringFragment(fragments, base, 'title', 'title', row['title']);
  pushStringFragment(fragments, base, 'sku', 'option_value', row['sku']);
  pushStringFragment(fragments, base, 'barcode', 'option_value', row['barcode']);

  if (Array.isArray(row['selected_options'])) {
    for (const [index, option] of row['selected_options'].entries()) {
      if (!option || typeof option !== 'object') continue;
      const optionObj = option as Record<string, unknown>;
      pushStringFragment(
        fragments,
        base,
        `selected_options.${index}.name`,
        'option_name',
        optionObj['name']
      );
      pushStringFragment(
        fragments,
        base,
        `selected_options.${index}.value`,
        'option_value',
        optionObj['value']
      );
    }
  }

  return fragments;
}

function collectCollectionFragmentsFromRow(
  id: string,
  row: Record<string, unknown>
): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_collections',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    collectionId: id,
  };

  pushStringFragment(fragments, base, 'title', 'title', row['title']);
  pushStringFragment(fragments, base, 'description', 'description', row['description']);
  pushStringFragment(fragments, base, 'description_html', 'description', row['description_html']);
  pushStringFragment(fragments, base, 'seo_title', 'seo_title', row['seo_title']);
  pushStringFragment(fragments, base, 'seo_description', 'seo_description', row['seo_description']);

  if (row['seo'] && typeof row['seo'] === 'object') {
    const seo = row['seo'] as Record<string, unknown>;
    pushStringFragment(fragments, base, 'seo.title', 'seo_title', seo['title']);
    pushStringFragment(fragments, base, 'seo.description', 'seo_description', seo['description']);
  }

  return fragments;
}

function collectMasterProductFragmentsFromRow(
  id: string,
  row: Record<string, unknown>
): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'prod_master',
    sourceRecordId: id,
    masterProductId: id,
    categoryHint: typeof row['taxonomy_id'] === 'string' ? row['taxonomy_id'] : null,
  };
  pushStringFragment(fragments, base, 'canonical_title', 'title', row['canonical_title']);
  pushStringFragment(fragments, base, 'brand', 'vendor', row['brand']);
  pushStringFragment(fragments, base, 'manufacturer', 'vendor', row['manufacturer']);
  return fragments;
}

function collectFragmentsFromRow(
  sourceTable: SourceTableName,
  row: Record<string, unknown>
): FragmentInput[] {
  const id = String(row['id']);
  if (sourceTable === 'shopify_products') {
    return collectProductFragmentsFromRow(id, row);
  }
  if (sourceTable === 'shopify_variants') {
    return collectVariantFragmentsFromRow(id, row);
  }
  if (sourceTable === 'shopify_collections') {
    return collectCollectionFragmentsFromRow(id, row);
  }
  return collectMasterProductFragmentsFromRow(id, row);
}

async function insertFragmentsForShard(params: {
  client: TenantClient;
  runId: string;
  shopId: string;
  shardId: string;
  sourceTable: SourceTableName;
  rows: Record<string, unknown>[];
  languageGuess: string;
  env: AppEnv;
  logger: Logger;
}): Promise<{
  recordsRead: number;
  recordsWritten: number;
  sourceRecordIds: string[];
  guardrailsBlocked: number;
}> {
  const sourceRecordIds = params.rows
    .map((row) => (typeof row['id'] === 'string' ? row['id'] : null))
    .filter((value): value is string => Boolean(value));

  if (sourceRecordIds.length === 0) {
    return { recordsRead: 0, recordsWritten: 0, sourceRecordIds: [], guardrailsBlocked: 0 };
  }

  await params.client.query(
    `DELETE FROM lex_fragments
     WHERE run_id = $1
       AND shop_id = $2
       AND source_table = $3
       AND source_record_id = ANY($4::uuid[])`,
    [params.runId, params.shopId, params.sourceTable, sourceRecordIds]
  );

  let recordsWritten = 0;
  let guardrailsBlocked = 0;
  for (const row of params.rows) {
    const fragments = collectFragmentsFromRow(params.sourceTable, row);
    for (const fragment of fragments) {
      const preserveHtml = shouldPreserveHtmlField(fragment.fieldPath);
      const rawForClean = preserveHtml ? fragment.rawText : stripHtml(fragment.rawText);
      const cleanText = normalizeWhitespace(rawForClean);
      const htmlStripped =
        !preserveHtml &&
        (rawTextContainsLikelyHtmlTag as (text: string) => boolean)(fragment.rawText);
      const canonicalText = canonicalizeText(cleanText);
      if (!canonicalText) continue;

      const inputScan = await scanLexInput({
        shopId: params.shopId,
        text: fragment.rawText,
        env: params.env,
        logger: params.logger,
      });
      if (!inputScan.isValid) {
        params.logger.warn(
          {
            shopId: params.shopId,
            runId: params.runId,
            sourceRecordId: fragment.sourceRecordId,
            fieldPath: fragment.fieldPath,
            reason: inputScan.reason,
          },
          'lex_extract_fragments_guardrail_blocked'
        );
        guardrailsBlocked += 1;
        continue;
      }

      const contentHash = sha256(
        JSON.stringify({
          runId: params.runId,
          sourceTable: params.sourceTable,
          sourceRecordId: fragment.sourceRecordId,
          fieldPath: fragment.fieldPath,
          canonicalText,
        })
      );

      await params.client.query(
        `INSERT INTO lex_fragments
           (run_id, shop_id, source_table, source_record_id, source_gid, product_id, variant_id,
            collection_id, master_product_id, field_path, field_kind, raw_text, clean_text,
            canonical_text, language_guess, html_stripped, token_count, char_count, vendor_hint,
            product_type_hint, category_hint, content_hash, is_noise, created_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, false, now())`,
        [
          params.runId,
          params.shopId,
          params.sourceTable,
          fragment.sourceRecordId,
          fragment.sourceGid ?? null,
          fragment.productId ?? null,
          fragment.variantId ?? null,
          fragment.collectionId ?? null,
          fragment.masterProductId ?? null,
          fragment.fieldPath,
          fragment.fieldKind,
          fragment.rawText,
          cleanText,
          canonicalText,
          params.languageGuess,
          htmlStripped,
          tokenCount(cleanText),
          cleanText.length,
          fragment.vendorHint ?? null,
          fragment.productTypeHint ?? null,
          fragment.categoryHint ?? null,
          contentHash,
        ]
      );
      recordsWritten += 1;
    }
  }

  await params.client.query(
    `UPDATE lex_runs
     SET fragments_count = (
           SELECT COUNT(*)::int
           FROM lex_fragments
           WHERE run_id = $1
             AND shop_id = $2
         ),
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [params.runId, params.shopId]
  );

  return {
    recordsRead: params.rows.length,
    recordsWritten,
    sourceRecordIds,
    guardrailsBlocked,
  };
}

async function resolveEffectiveLexRunType(
  client: TenantClient,
  runId: string,
  shopId: string,
  payloadRunType: string
): Promise<string> {
  const run = await client.query<{ runType: string }>(
    `SELECT run_type AS "runType"
     FROM lex_runs
     WHERE id = $1
       AND shop_id = $2
     LIMIT 1`,
    [runId, shopId]
  );
  return run.rows[0]?.runType ?? payloadRunType;
}

async function enqueuePendingTranslateCandidateShards(params: {
  shopId: string;
  runId: string;
  runPriority: number;
  pendingShardIds: readonly string[];
}): Promise<void> {
  const jobPayloadBase = {
    shopId: params.shopId,
    runId: params.runId,
    queuePhase: 'translate.candidates' as const,
    requestedAt: Date.now(),
  };
  for (const shardId of params.pendingShardIds) {
    await enqueueLexShardJob(
      LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
      { ...jobPayloadBase, shardId },
      { priority: params.runPriority }
    );
  }
}

async function finalizeEmptyExtractPlaceholder(
  client: TenantClient,
  placeholderId: string,
  shopId: string
): Promise<void> {
  await client.query(
    `UPDATE lex_run_shards
     SET status = 'completed',
         completed_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || '{"empty_source":true}'::jsonb
     WHERE id = $1
       AND shop_id = $2`,
    [placeholderId, shopId]
  );
}

async function assignShardRowForExtractWindow(params: {
  client: TenantClient;
  batchIndex: number;
  placeholder: Readonly<{ id: string; sourceTable: SourceTableName }>;
  runId: string;
  shopId: string;
  shardKey: string;
  first: SourceWindowRow;
  last: SourceWindowRow;
  shardMetadataJson: string;
}): Promise<string> {
  if (params.batchIndex === 0) {
    await params.client.query(
      `UPDATE lex_run_shards
       SET shard_key = $3,
           min_source_id = $4,
           max_source_id = $5,
           metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
       WHERE id = $1
         AND shop_id = $2`,
      [
        params.placeholder.id,
        params.shopId,
        params.shardKey,
        params.first.id,
        params.last.id,
        params.shardMetadataJson,
      ]
    );
    return params.placeholder.id;
  }

  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO lex_run_shards
       (run_id, shop_id, shard_key, phase_name, source_table, min_source_id, max_source_id, status, metadata, created_at)
     VALUES
       ($1, $2, $3, 'extract.fragments', $4, $5, $6, 'pending', $7::jsonb, now())
     RETURNING id`,
    [
      params.runId,
      params.shopId,
      params.shardKey,
      params.placeholder.sourceTable,
      params.first.id,
      params.last.id,
      params.shardMetadataJson,
    ]
  );
  return inserted.rows[0]!.id;
}

interface WatermarkRow {
  updatedAt: string | null;
  lastId: string | null;
}

function deltaWatermarkCursor(
  runType: string,
  watermark: { rows: WatermarkRow[] }
): { watermarkUpdatedAt: string | null; watermarkId: string | null } {
  if (runType !== 'delta_rebuild') {
    return { watermarkUpdatedAt: null, watermarkId: null };
  }
  const row = watermark.rows[0];
  return {
    watermarkUpdatedAt: row?.updatedAt ?? null,
    watermarkId: row?.lastId ?? null,
  };
}

async function enqueueExtractJobsForPlaceholder(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  runType: string;
  runPriority: number;
  shardSize: number;
  placeholder: Readonly<{ id: string; sourceTable: SourceTableName }>;
}): Promise<number> {
  const watermark = await params.client.query<{ updatedAt: string | null; lastId: string | null }>(
    `SELECT
       last_success_updated_at::text AS "updatedAt",
       last_success_id AS "lastId"
     FROM lex_source_watermarks
     WHERE shop_id = $1
       AND source_table = $2
       AND phase_name = 'extract.fragments'
     LIMIT 1`,
    [params.shopId, params.placeholder.sourceTable]
  );
  const wm = deltaWatermarkCursor(params.runType, watermark);

  let afterUpdatedAt: string | null = null;
  let afterId: string | null = null;
  let batchIndex = 0;
  let shardsEnqueued = 0;

  for (;;) {
    const rows = await loadSourceWindow({
      client: params.client,
      shopId: params.shopId,
      sourceTable: params.placeholder.sourceTable,
      shardSize: params.shardSize,
      afterUpdatedAt,
      afterId,
      watermarkUpdatedAt: wm.watermarkUpdatedAt,
      watermarkId: wm.watermarkId,
    });

    if (rows.length === 0) {
      if (batchIndex === 0) {
        await finalizeEmptyExtractPlaceholder(params.client, params.placeholder.id, params.shopId);
      }
      break;
    }

    const first = rows[0]!;
    const last = rows.at(-1)!;
    const shardMetadata = {
      windowStartUpdatedAt: first.updatedAt,
      windowStartId: first.id,
      windowEndUpdatedAt: last.updatedAt,
      windowEndId: last.id,
      shardSize: rows.length,
    };
    const shardMetadataJson = JSON.stringify(shardMetadata);
    const shardKey = `${params.placeholder.sourceTable}:${first.updatedAt}:${first.id}:${last.id}`;

    const shardId = await assignShardRowForExtractWindow({
      client: params.client,
      batchIndex,
      placeholder: params.placeholder,
      runId: params.runId,
      shopId: params.shopId,
      shardKey,
      first,
      last,
      shardMetadataJson,
    });

    const batchPriority = lexShardBatchPriority({
      runPriority: params.runPriority,
      batchRecordCount: rows.length,
    });
    await enqueueLexShardJob(
      LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
      {
        shopId: params.shopId,
        runId: params.runId,
        shardId,
        queuePhase: 'extract.fragments',
        requestedAt: Date.now(),
      },
      { priority: batchPriority }
    );
    shardsEnqueued += 1;
    batchIndex += 1;
    afterUpdatedAt = last.updatedAt;
    afterId = last.id;
  }

  return shardsEnqueued;
}

async function scheduleExtractFragmentShardJobs(
  client: TenantClient,
  payload: LexRunRequestedJobPayload
): Promise<{ shardCount: number }> {
  const settings = await client.query<{ shardSize: number }>(
    `SELECT shard_size AS "shardSize"
     FROM lex_shop_settings
     WHERE shop_id = $1
     LIMIT 1`,
    [payload.shopId]
  );
  const shardSize = Math.max(100, Math.min(100_000, settings.rows[0]?.shardSize ?? 10_000));

  const runType = await resolveEffectiveLexRunType(
    client,
    payload.runId,
    payload.shopId,
    payload.runType
  );
  const runPriority = lexRunTypePriority(runType);

  const placeholders = await client.query<{
    id: string;
    sourceTable: SourceTableName;
  }>(
    `SELECT id, source_table AS "sourceTable"
     FROM lex_run_shards
     WHERE run_id = $1
       AND shop_id = $2
       AND phase_name = 'extract.fragments'
       AND shard_key LIKE '%:all'
     ORDER BY created_at ASC`,
    [payload.runId, payload.shopId]
  );

  let totalShards = 0;
  for (const placeholder of placeholders.rows) {
    totalShards += await enqueueExtractJobsForPlaceholder({
      client,
      shopId: payload.shopId,
      runId: payload.runId,
      runType,
      runPriority,
      shardSize,
      placeholder,
    });
  }

  return { shardCount: totalShards };
}

async function shardRunRequest(params: {
  payload: LexRunRequestedJobPayload;
  logger: Logger;
}): Promise<{ shardCount: number }> {
  const effectiveRunType = await withTenantContext(params.payload.shopId, (client) =>
    resolveEffectiveLexRunType(
      client,
      params.payload.runId,
      params.payload.shopId,
      params.payload.runType
    )
  );

  if (effectiveRunType === 'translate_only') {
    await markLexRunStarted({
      shopId: params.payload.shopId,
      runId: params.payload.runId,
      phaseName: 'translate.candidates',
    });

    const pending = await withTenantContext(params.payload.shopId, async (client) =>
      client.query<{ id: string }>(
        `SELECT id
         FROM lex_run_shards
         WHERE run_id = $1
           AND shop_id = $2
           AND phase_name = 'translate.candidates'
           AND status = 'pending'
         ORDER BY created_at ASC`,
        [params.payload.runId, params.payload.shopId]
      )
    );

    const runPriority = lexRunTypePriority(effectiveRunType);
    await enqueuePendingTranslateCandidateShards({
      shopId: params.payload.shopId,
      runId: params.payload.runId,
      runPriority,
      pendingShardIds: pending.rows.map((r) => r.id),
    });

    return { shardCount: pending.rows.length };
  }

  await markLexRunStarted({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'extract.fragments',
  });

  const result = await withTenantContext(params.payload.shopId, (client) =>
    scheduleExtractFragmentShardJobs(client, params.payload)
  );

  await recordLexPhaseEvent({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'extract.fragments',
    eventType: 'run_sharded',
    details: result,
  });

  if (result.shardCount === 0) {
    await advanceLexRunPhaseIfComplete({
      shopId: params.payload.shopId,
      runId: params.payload.runId,
      phaseName: 'extract.fragments',
      logger: params.logger,
    });
  }

  return result;
}

async function processExtractFragmentShard(params: {
  payload: LexShardJobPayload;
  logger: Logger;
}): Promise<{ recordsRead: number; recordsWritten: number }> {
  const shard = await loadLexShard({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
  });

  if (shard?.phaseName !== 'extract.fragments') {
    return { recordsRead: 0, recordsWritten: 0 };
  }

  await markLexShardActive({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    workerName: 'lex-extract-fragments-worker',
  });

  const env = loadEnv();
  const result = await withTenantContext(params.payload.shopId, async (client) => {
    const { sourceLang } = await loadLexShopLangPair({
      client,
      shopId: params.payload.shopId,
    });
    const rows = await fetchShardSourceRows({
      client,
      shopId: params.payload.shopId,
      sourceTable: shard.sourceTable as SourceTableName,
      metadata: shard.metadata,
    });

    const counts = await insertFragmentsForShard({
      client,
      runId: params.payload.runId,
      shopId: params.payload.shopId,
      shardId: params.payload.shardId,
      sourceTable: shard.sourceTable as SourceTableName,
      rows,
      languageGuess: sourceLang,
      env,
      logger: params.logger,
    });

    const endUpdatedAt =
      typeof shard.metadata['windowEndUpdatedAt'] === 'string'
        ? shard.metadata['windowEndUpdatedAt']
        : null;
    const endId =
      typeof shard.metadata['windowEndId'] === 'string' ? shard.metadata['windowEndId'] : null;
    if (endUpdatedAt && endId) {
      await client.query(
        `INSERT INTO lex_source_watermarks
           (shop_id, source_table, phase_name, last_success_updated_at, last_success_id, snapshot_hash, updated_at)
         VALUES
           ($1, $2, 'extract.fragments', $3::timestamptz, $4, NULL, now())
         ON CONFLICT (shop_id, source_table, phase_name)
         DO UPDATE
            SET last_success_updated_at = EXCLUDED.last_success_updated_at,
                last_success_id = EXCLUDED.last_success_id,
                updated_at = now()`,
        [params.payload.shopId, shard.sourceTable, endUpdatedAt, endId]
      );
    }

    return counts;
  });

  await saveLexCheckpoint({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    workerName: 'lex-extract-fragments-worker',
    checkpointType: 'phase_marker',
    checkpointValue: {
      phase: 'extract.fragments',
      status: 'completed',
      recordsRead: result.recordsRead,
      recordsWritten: result.recordsWritten,
    },
  });

  await markLexShardCompleted({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    recordsRead: result.recordsRead,
    recordsWritten: result.recordsWritten,
    metadataPatch: {
      sourceRecordIds: result.sourceRecordIds,
    },
  }).catch(() => undefined);

  await recordLexPhaseEvent({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    phaseName: 'extract.fragments',
    eventType: 'shard_completed',
    details: result,
  });

  await advanceLexRunPhaseIfComplete({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'extract.fragments',
    logger: params.logger,
  });

  return result;
}

/** Aliniat la {@link createLexWorker} din worker-toolkit (BullMQ job minimal). */
interface LexQueueJob {
  id?: string | number | null;
  name: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
}

async function handleLexRunRequestedExtractFragmentsJob(
  job: LexQueueJob,
  logger: Logger
): Promise<{ shardCount: number }> {
  const payload = job.data as LexRunRequestedJobPayload;
  if (!validateLexRunRequestedJobPayload(payload)) {
    throw new Error('invalid_lex_run_requested_payload');
  }
  try {
    return await shardRunRequest({ payload, logger });
  } catch (error) {
    await markLexRunFailed({
      shopId: payload.shopId,
      runId: payload.runId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

async function handleLexShardProcessExtractFragmentsJob(
  job: LexQueueJob,
  logger: Logger
): Promise<{ recordsRead: number; recordsWritten: number }> {
  const payload = job.data as LexShardJobPayload;
  if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'extract.fragments') {
    throw new Error('invalid_lex_extract_fragments_shard_payload');
  }
  try {
    return await processExtractFragmentShard({ payload, logger });
  } catch (error) {
    await markLexShardFailed({
      shopId: payload.shopId,
      shardId: payload.shardId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

async function dispatchLexExtractFragmentsQueueJob(
  job: LexQueueJob,
  logger: Logger
): Promise<unknown> {
  if (job.name === LEX_RUN_REQUESTED_JOB_NAME) {
    return handleLexRunRequestedExtractFragmentsJob(job, logger);
  }
  if (job.name === LEX_SHARD_PROCESS_JOB_NAME) {
    return handleLexShardProcessExtractFragmentsJob(job, logger);
  }
  throw new Error(`unknown_lex_extract_fragments_job:${job.name}`);
}

export function startLexExtractFragmentsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
    workerId: 'lex-extract-fragments-worker',
    processor: (job) => dispatchLexExtractFragmentsQueueJob(job, logger),
  });
}
