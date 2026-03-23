import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { validateTermContent } from '../../services/lex-guardrails.js';
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
  loadLexShopLangPair,
  loadProtectedSpans,
  normalizeLexeme,
  parseShardSourceRecordIds,
  sha256,
  tokenizeLexText,
  type LexToken,
  type TenantClient,
} from './pipeline-utils.js';
import {
  buildLexTermMiningWindows,
  shouldSkipLexMiningToken,
  type LexMiningProtectedSpan,
  type LexTermMiningWindow,
} from './mine-terms-pure.js';

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
  const termType = params.ngramSize > 1 ? 'phrase' : 'token';
  const inserted = await params.client.query<TermRow>(
    `INSERT INTO lex_terms
       (shop_id, canonical_text, normalized_key, display_text_ro, ngram_size, term_type,
        is_technical, is_protected, first_seen_at, last_seen_at, status, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), 'active', now(), now())
     ON CONFLICT (shop_id, normalized_key, ngram_size)
       WHERE (status <> 'merged')
     DO UPDATE SET
       last_seen_at = now(),
       display_text_ro = COALESCE(lex_terms.display_text_ro, EXCLUDED.display_text_ro),
       is_technical = EXCLUDED.is_technical,
       is_protected = EXCLUDED.is_protected,
       updated_at = now()
     RETURNING id`,
    [
      params.shopId,
      params.canonicalText,
      params.normalizedKey,
      params.canonicalText,
      params.ngramSize,
      termType,
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
  locale: string;
}): Promise<void> {
  await params.client.query(
    `INSERT INTO lex_term_variants
       (term_id, shop_id, variant_text, normalized_variant, locale, script, variant_type,
        source, is_preferred, is_approved, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, 'latin', $6, 'extracted', $7, false, now(), now())
     ON CONFLICT (term_id, normalized_variant, locale)
     DO UPDATE SET
       variant_text = EXCLUDED.variant_text,
       is_preferred = lex_term_variants.is_preferred OR EXCLUDED.is_preferred,
       updated_at = now()`,
    [
      params.termId,
      params.shopId,
      params.variantText,
      params.normalizedVariant,
      params.locale,
      params.isPreferred ? 'preferred' : 'surface',
      params.isPreferred,
    ]
  );
}

interface MineTermsMutableAccumulator {
  occurrencesWritten: number;
  guardrailsBlocked: number;
}

type MineTermsShardWriteResult = Readonly<{
  fragmentsProcessed: number;
  occurrencesWritten: number;
  termIdsTouched: string[];
  guardrailsBlocked: number;
}>;

async function refreshLexRunMineTermsStats(params: {
  client: TenantClient;
  runId: string;
  shopId: string;
}): Promise<void> {
  await params.client.query(
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
    [params.runId, params.shopId]
  );
}

async function persistLexMiningWindow(params: {
  client: TenantClient;
  runId: string;
  shopId: string;
  fragment: FragmentRow;
  sourceLang: string;
  logger: Logger;
  tokens: readonly LexToken[];
  startTokenIndex: number;
  window: LexTermMiningWindow;
  tokenAtStart: LexToken;
  termCache: Map<string, string>;
  termIdsTouched: Set<string>;
  acc: MineTermsMutableAccumulator;
}): Promise<void> {
  const normalizedKey = normalizeLexeme(params.window.normalized);
  if (!normalizedKey || normalizedKey.length < 2) return;

  const termValidation = validateTermContent(params.window.raw);
  if (!termValidation.valid) {
    params.logger.warn(
      {
        shopId: params.shopId,
        runId: params.runId,
        fragmentId: params.fragment.id,
        termText: params.window.raw.slice(0, 100),
        reason: termValidation.reason,
      },
      'lex_mine_terms_guardrail_blocked'
    );
    params.acc.guardrailsBlocked += 1;
    return;
  }

  const { startTokenIndex, window, tokenAtStart, tokens } = params;
  const cacheKey = `${normalizedKey}:${window.endIndex - startTokenIndex + 1}`;
  let termId = params.termCache.get(cacheKey);
  if (!termId) {
    termId = await upsertLexTerm({
      client: params.client,
      shopId: params.shopId,
      canonicalText: window.raw,
      normalizedKey,
      ngramSize: window.endIndex - startTokenIndex + 1,
      isTechnical: /\d/.test(window.raw),
      isProtected: false,
    });
    params.termCache.set(cacheKey, termId);
  }

  await upsertLexVariant({
    client: params.client,
    termId,
    shopId: params.shopId,
    variantText: window.raw,
    normalizedVariant: normalizedKey,
    isPreferred: window.endIndex === startTokenIndex,
    locale: params.sourceLang,
  });

  const context = buildContextWindow(tokens, startTokenIndex, window.endIndex);
  const contextHash = sha256(
    JSON.stringify({
      fragmentId: params.fragment.id,
      termId,
      positionStart: tokenAtStart.start,
      positionEnd: tokens[window.endIndex]!.end,
      neighbors: context.neighborTerms,
    })
  );

  await params.client.query(
    `INSERT INTO lex_term_occurrences
       (run_id, shop_id, term_id, fragment_id, position_start, position_end, sentence_index, token_index,
        left_context, right_context, neighbor_terms, context_hash, created_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10::text[], $11, now())`,
    [
      params.runId,
      params.shopId,
      termId,
      params.fragment.id,
      tokenAtStart.start,
      tokens[window.endIndex]!.end,
      startTokenIndex,
      context.leftContext,
      context.rightContext,
      context.neighborTerms,
      contextHash,
    ]
  );

  params.termIdsTouched.add(termId);
  params.acc.occurrencesWritten += 1;
}

async function mineTermsForSingleFragment(params: {
  client: TenantClient;
  runId: string;
  shopId: string;
  fragment: FragmentRow;
  sourceLang: string;
  protectedSpans: readonly LexMiningProtectedSpan[];
  stopwords: ReadonlySet<string>;
  termCache: Map<string, string>;
  termIdsTouched: Set<string>;
  acc: MineTermsMutableAccumulator;
  logger: Logger;
}): Promise<void> {
  const tokens = tokenizeLexText(params.fragment.cleanText);
  if (tokens.length === 0) return;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (shouldSkipLexMiningToken(token, params.protectedSpans, params.stopwords)) continue;

    const windows = buildLexTermMiningWindows(
      tokens,
      index,
      params.protectedSpans,
      params.stopwords
    );

    for (const window of windows) {
      await persistLexMiningWindow({
        client: params.client,
        runId: params.runId,
        shopId: params.shopId,
        fragment: params.fragment,
        sourceLang: params.sourceLang,
        logger: params.logger,
        tokens,
        startTokenIndex: index,
        window,
        tokenAtStart: token,
        termCache: params.termCache,
        termIdsTouched: params.termIdsTouched,
        acc: params.acc,
      });
    }
  }
}

async function runMineTermsTenantWrites(params: {
  client: TenantClient;
  payload: LexShardJobPayload;
  shard: { metadata: Record<string, unknown>; sourceTable: string };
  logger: Logger;
}): Promise<MineTermsShardWriteResult> {
  const empty: MineTermsShardWriteResult = {
    fragmentsProcessed: 0,
    occurrencesWritten: 0,
    termIdsTouched: [],
    guardrailsBlocked: 0,
  };

  const { sourceLang } = await loadLexShopLangPair({
    client: params.client,
    shopId: params.payload.shopId,
  });
  const sourceRecordIds = parseShardSourceRecordIds(params.shard.metadata);
  if (sourceRecordIds.length === 0) {
    return empty;
  }

  const fragments = await params.client.query<FragmentRow>(
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
    [params.payload.runId, params.payload.shopId, params.shard.sourceTable, sourceRecordIds]
  );

  if (fragments.rows.length === 0) {
    return empty;
  }

  const stopwords = await loadActiveStopwords({
    client: params.client,
    shopId: params.payload.shopId,
    locale: sourceLang,
  });
  const protectedSpansByFragment = await loadProtectedSpans({
    client: params.client,
    shopId: params.payload.shopId,
    fragmentIds: fragments.rows.map((fragment) => fragment.id),
  });

  await params.client.query(
    `DELETE FROM lex_term_occurrences
     WHERE run_id = $1
       AND shop_id = $2
       AND fragment_id = ANY($3::uuid[])`,
    [params.payload.runId, params.payload.shopId, fragments.rows.map((fragment) => fragment.id)]
  );

  const termCache = new Map<string, string>();
  const termIdsTouched = new Set<string>();
  const acc: MineTermsMutableAccumulator = { occurrencesWritten: 0, guardrailsBlocked: 0 };

  for (const fragment of fragments.rows) {
    const protectedSpans = protectedSpansByFragment.get(fragment.id) ?? [];
    await mineTermsForSingleFragment({
      client: params.client,
      runId: params.payload.runId,
      shopId: params.payload.shopId,
      fragment,
      sourceLang,
      protectedSpans,
      stopwords,
      termCache,
      termIdsTouched,
      acc,
      logger: params.logger,
    });
  }

  await refreshLexRunMineTermsStats({
    client: params.client,
    runId: params.payload.runId,
    shopId: params.payload.shopId,
  });

  return {
    fragmentsProcessed: fragments.rows.length,
    occurrencesWritten: acc.occurrencesWritten,
    termIdsTouched: [...termIdsTouched],
    guardrailsBlocked: acc.guardrailsBlocked,
  };
}

async function processMineTermsShard(params: {
  payload: LexShardJobPayload;
  logger: Logger;
}): Promise<MineTermsShardWriteResult> {
  const shard = await loadLexShard({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
  });
  if (shard?.phaseName !== 'mine.terms') {
    return {
      fragmentsProcessed: 0,
      occurrencesWritten: 0,
      termIdsTouched: [],
      guardrailsBlocked: 0,
    };
  }

  await markLexShardActive({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    workerName: 'lex-mine-terms-worker',
  });

  const result = await withTenantContext(params.payload.shopId, async (client) =>
    runMineTermsTenantWrites({
      client,
      payload: params.payload,
      shard,
      logger: params.logger,
    })
  );

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
      guardrailsBlocked: result.guardrailsBlocked,
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
  }).catch(() => undefined);

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
