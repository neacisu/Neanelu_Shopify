import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { LEX_MINE_TERMS_QUEUE_NAME, LEX_SHARD_PROCESS_JOB_NAME } from '../../queue/lex-queues.js';
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
  buildContextWindow,
  loadActiveStopwords,
  loadProtectedSpans,
  normalizeLexeme,
  parseShardSourceRecordIds,
  sha256,
  tokenizeLexText,
  tokenOverlapsProtectedSpan,
  type TenantClient,
} from './pipeline-utils.js';

type FragmentRow = Readonly<{
  id: string;
  cleanText: string;
  fieldKind: string;
  sourceTable: string;
  sourceRecordId: string;
  productId: string | null;
  variantId: string | null;
  collectionId: string | null;
  vendorHint: string | null;
  productTypeHint: string | null;
}>;

type TermRow = Readonly<{
  id: string;
}>;

async function upsertLexTerm(params: {
  client: TenantClient;
  shopId: string;
  canonicalText: string;
  normalizedKey: string;
  ngramSize: number;
  isTechnical: boolean;
  isProtected: boolean;
}): Promise<string> {
  const existing = await params.client.query<TermRow>(
    `SELECT id
     FROM lex_terms
     WHERE shop_id = $1
       AND normalized_key = $2
       AND ngram_size = $3
       AND status <> 'merged'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [params.shopId, params.normalizedKey, params.ngramSize]
  );

  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await params.client.query(
      `UPDATE lex_terms
       SET last_seen_at = now(),
           display_text_ro = COALESCE(display_text_ro, $4),
           is_technical = COALESCE(is_technical, false) OR $5,
           is_protected = COALESCE(is_protected, false) OR $6,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [
        existingId,
        params.shopId,
        params.normalizedKey,
        params.canonicalText,
        params.isTechnical,
        params.isProtected,
      ]
    );
    return existingId;
  }

  const inserted = await params.client.query<TermRow>(
    `INSERT INTO lex_terms
       (shop_id, canonical_text, normalized_key, display_text_ro, ngram_size, term_type,
        is_technical, is_protected, first_seen_at, last_seen_at, status, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), 'active', now(), now())
     RETURNING id`,
    [
      params.shopId,
      params.canonicalText,
      params.normalizedKey,
      params.canonicalText,
      params.ngramSize,
      params.ngramSize > 1 ? 'phrase' : 'token',
      params.isTechnical,
      params.isProtected,
    ]
  );

  return inserted.rows[0]!.id;
}

async function upsertLexVariant(params: {
  client: TenantClient;
  termId: string;
  shopId: string;
  variantText: string;
  normalizedVariant: string;
  isPreferred: boolean;
}): Promise<void> {
  const existing = await params.client.query<TermRow>(
    `SELECT id
     FROM lex_term_variants
     WHERE term_id = $1
       AND shop_id = $2
       AND normalized_variant = $3
     ORDER BY updated_at DESC
     LIMIT 1`,
    [params.termId, params.shopId, params.normalizedVariant]
  );

  if (existing.rows[0]?.id) {
    await params.client.query(
      `UPDATE lex_term_variants
       SET variant_text = $2,
           is_preferred = COALESCE(is_preferred, false) OR $3,
           updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, params.variantText, params.isPreferred]
    );
    return;
  }

  await params.client.query(
    `INSERT INTO lex_term_variants
       (term_id, shop_id, variant_text, normalized_variant, locale, script, variant_type,
        source, is_preferred, is_approved, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, 'ro', 'latin', $5, 'extracted', $6, false, now(), now())`,
    [
      params.termId,
      params.shopId,
      params.variantText,
      params.normalizedVariant,
      params.isPreferred ? 'preferred' : 'surface',
      params.isPreferred,
    ]
  );
}

async function processMineTermsShard(params: {
  payload: LexShardJobPayload;
  logger: Logger;
}): Promise<{ fragmentsProcessed: number; occurrencesWritten: number; termIdsTouched: string[] }> {
  const shard = await loadLexShard({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
  });
  if (shard?.phaseName !== 'mine.terms') {
    return { fragmentsProcessed: 0, occurrencesWritten: 0, termIdsTouched: [] };
  }

  await markLexShardActive({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    workerName: 'lex-mine-terms-worker',
  });

  const result = await withTenantContext(params.payload.shopId, async (client) => {
    const sourceRecordIds = parseShardSourceRecordIds(shard.metadata);
    if (sourceRecordIds.length === 0) {
      return { fragmentsProcessed: 0, occurrencesWritten: 0, termIdsTouched: [] };
    }

    const fragments = await client.query<FragmentRow>(
      `SELECT
         id,
         clean_text AS "cleanText",
         field_kind AS "fieldKind",
         source_table AS "sourceTable",
         source_record_id AS "sourceRecordId",
         product_id AS "productId",
         variant_id AS "variantId",
         collection_id AS "collectionId",
         vendor_hint AS "vendorHint",
         product_type_hint AS "productTypeHint"
       FROM lex_fragments
       WHERE run_id = $1
         AND shop_id = $2
         AND source_table = $3
         AND source_record_id = ANY($4::uuid[])`,
      [params.payload.runId, params.payload.shopId, shard.sourceTable, sourceRecordIds]
    );

    if (fragments.rows.length === 0) {
      return { fragmentsProcessed: 0, occurrencesWritten: 0, termIdsTouched: [] };
    }

    const stopwords = await loadActiveStopwords({
      client,
      shopId: params.payload.shopId,
      locale: 'ro',
    });
    const protectedSpansByFragment = await loadProtectedSpans({
      client,
      shopId: params.payload.shopId,
      fragmentIds: fragments.rows.map((fragment) => fragment.id),
    });

    await client.query(
      `DELETE FROM lex_term_occurrences
       WHERE run_id = $1
         AND shop_id = $2
         AND fragment_id = ANY($3::uuid[])`,
      [params.payload.runId, params.payload.shopId, fragments.rows.map((fragment) => fragment.id)]
    );

    const termCache = new Map<string, string>();
    const termIdsTouched = new Set<string>();
    let occurrencesWritten = 0;

    for (const fragment of fragments.rows) {
      const protectedSpans = protectedSpansByFragment.get(fragment.id) ?? [];
      const tokens = tokenizeLexText(fragment.cleanText);
      if (tokens.length === 0) continue;

      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token) continue;
        if (tokenOverlapsProtectedSpan(token, protectedSpans)) continue;
        if (stopwords.has(token.normalized) || token.normalized.length < 2) continue;
        if (/^\d+$/.test(token.normalized)) continue;

        const windows: { raw: string; normalized: string; endIndex: number }[] = [
          {
            raw: token.raw,
            normalized: token.normalized,
            endIndex: index,
          },
        ];

        const nextToken = tokens[index + 1];
        if (
          nextToken &&
          !tokenOverlapsProtectedSpan(nextToken, protectedSpans) &&
          !stopwords.has(nextToken.normalized)
        ) {
          windows.push({
            raw: `${token.raw} ${nextToken.raw}`,
            normalized: `${token.normalized} ${nextToken.normalized}`,
            endIndex: index + 1,
          });
        }

        for (const window of windows) {
          const normalizedKey = normalizeLexeme(window.normalized);
          if (!normalizedKey || normalizedKey.length < 2) continue;

          const cacheKey = `${normalizedKey}:${window.endIndex - index + 1}`;
          let termId = termCache.get(cacheKey);
          if (!termId) {
            termId = await upsertLexTerm({
              client,
              shopId: params.payload.shopId,
              canonicalText: window.raw,
              normalizedKey,
              ngramSize: window.endIndex - index + 1,
              isTechnical: /\d/.test(window.raw),
              isProtected: false,
            });
            termCache.set(cacheKey, termId);
          }

          await upsertLexVariant({
            client,
            termId,
            shopId: params.payload.shopId,
            variantText: window.raw,
            normalizedVariant: normalizedKey,
            isPreferred: window.endIndex === index,
          });

          const context = buildContextWindow(tokens, index, window.endIndex);
          const contextHash = sha256(
            JSON.stringify({
              fragmentId: fragment.id,
              termId,
              positionStart: token.start,
              positionEnd: tokens[window.endIndex]!.end,
              neighbors: context.neighborTerms,
            })
          );

          await client.query(
            `INSERT INTO lex_term_occurrences
               (run_id, shop_id, term_id, fragment_id, position_start, position_end, sentence_index, token_index,
                left_context, right_context, neighbor_terms, context_hash, created_at)
             VALUES
               ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10::text[], $11, now())`,
            [
              params.payload.runId,
              params.payload.shopId,
              termId,
              fragment.id,
              token.start,
              tokens[window.endIndex]!.end,
              index,
              context.leftContext,
              context.rightContext,
              context.neighborTerms,
              contextHash,
            ]
          );

          termIdsTouched.add(termId);
          occurrencesWritten += 1;
        }
      }
    }

    await client.query(
      `UPDATE lex_runs
       SET occurrences_count = (
             SELECT COUNT(*)
             FROM lex_term_occurrences
             WHERE run_id = $1
               AND shop_id = $2
           ),
           terms_count = (
             SELECT COUNT(DISTINCT term_id)
             FROM lex_term_occurrences
             WHERE run_id = $1
               AND shop_id = $2
           ),
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.payload.runId, params.payload.shopId]
    );

    return {
      fragmentsProcessed: fragments.rows.length,
      occurrencesWritten,
      termIdsTouched: [...termIdsTouched],
    };
  });

  await saveLexCheckpoint({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    workerName: 'lex-mine-terms-worker',
    checkpointType: 'phase_marker',
    checkpointValue: {
      phase: 'mine.terms',
      status: 'completed',
      fragmentsProcessed: result.fragmentsProcessed,
      occurrencesWritten: result.occurrencesWritten,
      termIdsTouched: result.termIdsTouched,
    },
  });

  await markLexShardCompleted({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    recordsRead: result.fragmentsProcessed,
    recordsWritten: result.occurrencesWritten,
    metadataPatch: {
      termIdsTouched: result.termIdsTouched,
    },
  });

  await recordLexPhaseEvent({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    phaseName: 'mine.terms',
    eventType: 'shard_completed',
    details: result,
  });

  await advanceLexRunPhaseIfComplete({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'mine.terms',
    logger: params.logger,
  });

  return result;
}

export function startLexMineTermsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_MINE_TERMS_QUEUE_NAME,
    workerId: 'lex-mine-terms-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_mine_terms_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'mine.terms') {
        throw new Error('invalid_lex_mine_terms_shard_payload');
      }

      try {
        return await processMineTermsShard({ payload, logger });
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
