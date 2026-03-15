import { createHash } from 'node:crypto';

import type { Logger } from '@app/logger';
import type { LexRunRequestedJobPayload, LexShardJobPayload } from '@app/types';
import { validateLexRunRequestedJobPayload, validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  enqueueLexShardJob,
  LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  LEX_RUN_REQUESTED_JOB_NAME,
  LEX_SHARD_PROCESS_JOB_NAME,
} from '../../queue/lex-queues.js';
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

interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: TRow[]; rowCount: number }>;
}

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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function canonicalizeText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function tokenCount(value: string): number {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function normalizeMetafields(value: unknown): FragmentInput[] {
  if (!value || typeof value !== 'object') return [];
  const out: FragmentInput[] = [];

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) {
      out.push({
        sourceTable: 'shopify_products',
        sourceRecordId: '',
        fieldPath: `metafields.${key}`,
        fieldKind: 'metafield',
        rawText: raw,
      });
      continue;
    }

    if (raw && typeof raw === 'object') {
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
    }
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

function collectFragmentsFromRow(
  sourceTable: SourceTableName,
  row: Record<string, unknown>
): FragmentInput[] {
  const id = String(row['id']);
  if (sourceTable === 'shopify_products') {
    const fragments: FragmentInput[] = [];
    const base = {
      sourceTable,
      sourceRecordId: id,
      sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
      productId: id,
      vendorHint: typeof row['vendor'] === 'string' ? row['vendor'] : null,
      productTypeHint: typeof row['product_type'] === 'string' ? row['product_type'] : null,
      categoryHint: typeof row['category_id'] === 'string' ? row['category_id'] : null,
    };

    const pushMaybe = (fieldPath: string, fieldKind: string, rawValue: unknown) => {
      if (typeof rawValue === 'string' && rawValue.trim()) {
        fragments.push({ ...base, fieldPath, fieldKind, rawText: rawValue });
      }
    };

    pushMaybe('title', 'title', row['title']);
    pushMaybe('description', 'description', row['description']);
    pushMaybe('description_html', 'description', row['description_html']);
    pushMaybe('vendor', 'vendor', row['vendor']);
    pushMaybe('product_type', 'product_type', row['product_type']);

    const tags = Array.isArray(row['tags'])
      ? row['tags'].filter((tag) => typeof tag === 'string')
      : [];
    for (const tag of tags) {
      pushMaybe('tags[]', 'tag', tag);
    }

    if (row['seo'] && typeof row['seo'] === 'object') {
      const seo = row['seo'] as Record<string, unknown>;
      pushMaybe('seo.title', 'seo_title', seo['title']);
      pushMaybe('seo.description', 'seo_description', seo['description']);
    }

    const metafieldFragments = normalizeMetafields(row['metafields']).map((fragment) => ({
      ...fragment,
      ...base,
    }));
    fragments.push(...metafieldFragments);

    return fragments;
  }

  if (sourceTable === 'shopify_variants') {
    const fragments: FragmentInput[] = [];
    const base = {
      sourceTable,
      sourceRecordId: id,
      sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
      productId: typeof row['product_id'] === 'string' ? row['product_id'] : null,
      variantId: id,
    };

    const pushMaybe = (fieldPath: string, fieldKind: string, rawValue: unknown) => {
      if (typeof rawValue === 'string' && rawValue.trim()) {
        fragments.push({ ...base, fieldPath, fieldKind, rawText: rawValue });
      }
    };

    pushMaybe('title', 'title', row['title']);
    pushMaybe('sku', 'option_value', row['sku']);
    pushMaybe('barcode', 'option_value', row['barcode']);

    if (Array.isArray(row['selected_options'])) {
      for (const [index, option] of row['selected_options'].entries()) {
        if (!option || typeof option !== 'object') continue;
        const optionObj = option as Record<string, unknown>;
        pushMaybe(`selected_options.${index}.name`, 'option_name', optionObj['name']);
        pushMaybe(`selected_options.${index}.value`, 'option_value', optionObj['value']);
      }
    }

    return fragments;
  }

  if (sourceTable === 'shopify_collections') {
    const fragments: FragmentInput[] = [];
    const base = {
      sourceTable,
      sourceRecordId: id,
      sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
      collectionId: id,
    };

    const pushMaybe = (fieldPath: string, fieldKind: string, rawValue: unknown) => {
      if (typeof rawValue === 'string' && rawValue.trim()) {
        fragments.push({ ...base, fieldPath, fieldKind, rawText: rawValue });
      }
    };

    pushMaybe('title', 'title', row['title']);
    pushMaybe('description', 'description', row['description']);
    pushMaybe('description_html', 'description', row['description_html']);
    return fragments;
  }

  const fragments: FragmentInput[] = [];
  const base = {
    sourceTable,
    sourceRecordId: id,
    masterProductId: id,
    categoryHint: typeof row['taxonomy_id'] === 'string' ? row['taxonomy_id'] : null,
  };
  if (typeof row['canonical_title'] === 'string' && row['canonical_title'].trim()) {
    fragments.push({
      ...base,
      fieldPath: 'canonical_title',
      fieldKind: 'title',
      rawText: row['canonical_title'],
    });
  }
  if (typeof row['brand'] === 'string' && row['brand'].trim()) {
    fragments.push({
      ...base,
      fieldPath: 'brand',
      fieldKind: 'vendor',
      rawText: row['brand'],
    });
  }
  if (typeof row['manufacturer'] === 'string' && row['manufacturer'].trim()) {
    fragments.push({
      ...base,
      fieldPath: 'manufacturer',
      fieldKind: 'vendor',
      rawText: row['manufacturer'],
    });
  }
  return fragments;
}

async function insertFragmentsForShard(params: {
  client: TenantClient;
  runId: string;
  shopId: string;
  shardId: string;
  sourceTable: SourceTableName;
  rows: Record<string, unknown>[];
}): Promise<{ recordsRead: number; recordsWritten: number; sourceRecordIds: string[] }> {
  const sourceRecordIds = params.rows
    .map((row) => (typeof row['id'] === 'string' ? row['id'] : null))
    .filter((value): value is string => Boolean(value));

  if (sourceRecordIds.length === 0) {
    return { recordsRead: 0, recordsWritten: 0, sourceRecordIds: [] };
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
  for (const row of params.rows) {
    const fragments = collectFragmentsFromRow(params.sourceTable, row);
    for (const fragment of fragments) {
      const cleanText = normalizeWhitespace(
        fragment.fieldPath.includes('html') ? stripHtml(fragment.rawText) : fragment.rawText
      );
      const canonicalText = canonicalizeText(cleanText);
      if (!canonicalText) continue;

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
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ro', $15, $16, $17,
            $18, $19, $20, $21, false, now())`,
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
          fragment.fieldPath.includes('html'),
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
     SET fragments_count = COALESCE(fragments_count, 0) + $3,
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [params.runId, params.shopId, recordsWritten]
  );

  return {
    recordsRead: params.rows.length,
    recordsWritten,
    sourceRecordIds,
  };
}

async function shardRunRequest(params: {
  payload: LexRunRequestedJobPayload;
  logger: Logger;
}): Promise<{ shardCount: number }> {
  await markLexRunStarted({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'extract.fragments',
  });

  const result = await withTenantContext(params.payload.shopId, async (client) => {
    const settings = await client.query<{ shardSize: number }>(
      `SELECT shard_size AS "shardSize"
       FROM lex_shop_settings
       WHERE shop_id = $1
       LIMIT 1`,
      [params.payload.shopId]
    );
    const shardSize = Math.max(100, Math.min(100_000, settings.rows[0]?.shardSize ?? 10_000));

    const run = await client.query<{ runType: string }>(
      `SELECT run_type AS "runType"
       FROM lex_runs
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
      [params.payload.runId, params.payload.shopId]
    );
    const runType = run.rows[0]?.runType ?? params.payload.runType;

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
      [params.payload.runId, params.payload.shopId]
    );

    let totalShards = 0;

    for (const placeholder of placeholders.rows) {
      const watermark = await client.query<{ updatedAt: string | null; lastId: string | null }>(
        `SELECT
           last_success_updated_at::text AS "updatedAt",
           last_success_id AS "lastId"
         FROM lex_source_watermarks
         WHERE shop_id = $1
           AND source_table = $2
           AND phase_name = 'extract.fragments'
         LIMIT 1`,
        [params.payload.shopId, placeholder.sourceTable]
      );

      let afterUpdatedAt: string | null = null;
      let afterId: string | null = null;
      let batchIndex = 0;

      for (;;) {
        const rows = await loadSourceWindow({
          client,
          shopId: params.payload.shopId,
          sourceTable: placeholder.sourceTable,
          shardSize,
          afterUpdatedAt,
          afterId,
          watermarkUpdatedAt:
            runType === 'delta_rebuild' ? (watermark.rows[0]?.updatedAt ?? null) : null,
          watermarkId: runType === 'delta_rebuild' ? (watermark.rows[0]?.lastId ?? null) : null,
        });

        if (rows.length === 0) {
          if (batchIndex === 0) {
            await client.query(
              `UPDATE lex_run_shards
               SET status = 'completed',
                   completed_at = now(),
                   metadata = COALESCE(metadata, '{}'::jsonb) || '{"empty_source":true}'::jsonb
               WHERE id = $1
                 AND shop_id = $2`,
              [placeholder.id, params.payload.shopId]
            );
          }
          break;
        }

        const first = rows[0]!;
        const last = rows[rows.length - 1]!;
        const shardMetadata = {
          windowStartUpdatedAt: first.updatedAt,
          windowStartId: first.id,
          windowEndUpdatedAt: last.updatedAt,
          windowEndId: last.id,
          shardSize: rows.length,
        };
        const shardKey = `${placeholder.sourceTable}:${first.updatedAt}:${first.id}:${last.id}`;

        let shardId = placeholder.id;
        if (batchIndex === 0) {
          await client.query(
            `UPDATE lex_run_shards
             SET shard_key = $3,
                 min_source_id = $4,
                 max_source_id = $5,
                 metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
             WHERE id = $1
               AND shop_id = $2`,
            [
              placeholder.id,
              params.payload.shopId,
              shardKey,
              first.id,
              last.id,
              JSON.stringify(shardMetadata),
            ]
          );
        } else {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO lex_run_shards
               (run_id, shop_id, shard_key, phase_name, source_table, min_source_id, max_source_id, status, metadata, created_at)
             VALUES
               ($1, $2, $3, 'extract.fragments', $4, $5, $6, 'pending', $7::jsonb, now())
             RETURNING id`,
            [
              params.payload.runId,
              params.payload.shopId,
              shardKey,
              placeholder.sourceTable,
              first.id,
              last.id,
              JSON.stringify(shardMetadata),
            ]
          );
          shardId = inserted.rows[0]!.id;
        }

        await enqueueLexShardJob(LEX_EXTRACT_FRAGMENTS_QUEUE_NAME, {
          shopId: params.payload.shopId,
          runId: params.payload.runId,
          shardId,
          queuePhase: 'extract.fragments',
          requestedAt: Date.now(),
        });
        totalShards += 1;
        batchIndex += 1;
        afterUpdatedAt = last.updatedAt;
        afterId = last.id;
      }
    }

    return { shardCount: totalShards };
  });

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

  const result = await withTenantContext(params.payload.shopId, async (client) => {
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
  });

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

export function startLexExtractFragmentsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
    workerId: 'lex-extract-fragments-worker',
    processor: async (job) => {
      if (job.name === LEX_RUN_REQUESTED_JOB_NAME) {
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

      if (job.name === LEX_SHARD_PROCESS_JOB_NAME) {
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

      throw new Error(`unknown_lex_extract_fragments_job:${job.name}`);
    },
  });
}
