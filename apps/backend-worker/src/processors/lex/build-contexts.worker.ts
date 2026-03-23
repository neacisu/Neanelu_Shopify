import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_BUILD_CONTEXTS_QUEUE_NAME,
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
  loadLexShopLangPair,
  normalizeWhitespace,
  parseTouchedIds,
  uniqueStrings,
} from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';

/** Aliniat la extract-fragments: titlu / SEO / descriere înainte de vendor, tag, opțiuni, metafield. */
const FIELD_KIND_PRIORITY_SQL = `CASE f.field_kind
  WHEN 'title' THEN 1
  WHEN 'seo_title' THEN 2
  WHEN 'description' THEN 3
  WHEN 'seo_description' THEN 4
  WHEN 'vendor' THEN 5
  WHEN 'product_type' THEN 6
  WHEN 'tag' THEN 7
  WHEN 'option_name' THEN 8
  WHEN 'option_value' THEN 9
  WHEN 'metafield' THEN 10
  ELSE 99
END`;

type ContextAggregateRow = Readonly<{
  termId: string;
  representativeText: string;
  contextHash: string;
  fieldKind: string | null;
  vendorHint: string | null;
  productTypeHint: string | null;
  domainCode: string | null;
  taxonomyId: string | null;
  collectionIds: string[] | null;
  sampleProductIds: string[] | null;
  occurrencesCount: string;
}>;

const LEX_TERM_CONTEXT_INSERT_BATCH = 150;

async function batchInsertLexTermContexts(params: {
  client: TenantClient;
  shopId: string;
  sourceLang: string;
  rows: readonly ContextAggregateRow[];
}): Promise<string[]> {
  const ids: string[] = [];
  const { client, shopId, sourceLang, rows } = params;
  if (rows.length === 0) {
    return ids;
  }

  for (let offset = 0; offset < rows.length; offset += LEX_TERM_CONTEXT_INSERT_BATCH) {
    const chunk = rows.slice(offset, offset + LEX_TERM_CONTEXT_INSERT_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const row of chunk) {
      placeholders.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::uuid[], $${p++}, $${p++}::uuid[], $${p++}, now(), now())`
      );
      values.push(
        shopId,
        row.termId,
        normalizeWhitespace(row.representativeText),
        row.contextHash,
        row.fieldKind,
        row.vendorHint,
        row.productTypeHint,
        row.domainCode,
        row.taxonomyId,
        uniqueStrings(row.collectionIds ?? []),
        Number(row.occurrencesCount || 0),
        uniqueStrings(row.sampleProductIds ?? []).slice(0, 10),
        sourceLang
      );
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO lex_term_contexts
         (shop_id, term_id, representative_text, context_hash, field_kind, vendor_hint,
          product_type_hint, domain_code, taxonomy_id, collection_ids, occurrences_count,
          sample_product_ids, language_guess, created_at, updated_at)
       VALUES ${placeholders.join(', ')}
       RETURNING id`,
      values
    );
    for (const r of inserted.rows) {
      if (r.id) {
        ids.push(r.id);
      }
    }
  }

  return ids;
}

export function startLexBuildContextsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_BUILD_CONTEXTS_QUEUE_NAME,
    workerId: 'lex-build-contexts-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_build_contexts_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'build.contexts') {
        throw new Error('invalid_lex_build_contexts_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'build.contexts') {
        return { termIdsProcessed: 0, contextsWritten: 0, contextIdsTouched: [] };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-build-contexts-worker',
      });

      try {
        // withTenantContext (db.ts) = BEGIN → setTenantContext → callback → COMMIT/ROLLBACK:
        // DELETE + INSERT pe lex_term_contexts sunt atomice în aceeași tranzacție (f1-57).
        const result = await withTenantContext(payload.shopId, async (client) => {
          const { sourceLang } = await loadLexShopLangPair({
            client,
            shopId: payload.shopId,
          });
          const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
          if (termIds.length === 0) {
            return { termIdsProcessed: 0, contextsWritten: 0, contextIdsTouched: [] };
          }

          await client.query(
            `DELETE FROM lex_term_contexts
             WHERE shop_id = $1
               AND term_id = ANY($2::uuid[])`,
            [payload.shopId, termIds]
          );

          const aggregate = await client.query<ContextAggregateRow>(
            `SELECT
               o.term_id AS "termId",
               TRIM(CONCAT(COALESCE(o.left_context, ''), ' ', t.display_text_ro, ' ', COALESCE(o.right_context, ''))) AS "representativeText",
               o.context_hash AS "contextHash",
               (ARRAY_AGG(f.field_kind ORDER BY ${FIELD_KIND_PRIORITY_SQL}, f.id))[1] AS "fieldKind",
               (ARRAY_AGG(f.vendor_hint ORDER BY ${FIELD_KIND_PRIORITY_SQL}, f.id)
                 FILTER (WHERE f.vendor_hint IS NOT NULL))[1] AS "vendorHint",
               (ARRAY_AGG(f.product_type_hint ORDER BY ${FIELD_KIND_PRIORITY_SQL}, f.id)
                 FILTER (WHERE f.product_type_hint IS NOT NULL))[1] AS "productTypeHint",
               MAX(t.domain_code) AS "domainCode",
               (ARRAY_AGG(f.taxonomy_id::text ORDER BY ${FIELD_KIND_PRIORITY_SQL}, f.id)
                 FILTER (WHERE f.taxonomy_id IS NOT NULL))[1] AS "taxonomyId",
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT f.collection_id), NULL)::text[] AS "collectionIds",
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT f.product_id), NULL)::text[] AS "sampleProductIds",
               COUNT(*)::text AS "occurrencesCount"
             FROM lex_term_occurrences o
             INNER JOIN lex_fragments f
                     ON f.id = o.fragment_id
             INNER JOIN lex_terms t
                     ON t.id = o.term_id
             WHERE o.shop_id = $1
               AND f.shop_id = $1
               AND f.run_id = $3
               AND o.term_id = ANY($2::uuid[])
             GROUP BY o.term_id, o.context_hash, t.display_text_ro, o.left_context, o.right_context`,
            [payload.shopId, termIds, payload.runId]
          );

          const contextIdsTouched = await batchInsertLexTermContexts({
            client,
            shopId: payload.shopId,
            sourceLang,
            rows: aggregate.rows,
          });

          await client.query(
            `UPDATE lex_runs
             SET contexts_count = (
                   SELECT COUNT(*)::bigint
                   FROM lex_term_contexts c
                   WHERE c.shop_id = $2
                     AND EXISTS (
                       SELECT 1
                       FROM lex_term_occurrences o
                       INNER JOIN lex_fragments f ON f.id = o.fragment_id
                       WHERE o.term_id = c.term_id
                         AND o.shop_id = c.shop_id
                         AND f.run_id = $1
                         AND f.shop_id = $2
                     )
                 ),
                 updated_at = now()
             WHERE id = $1
               AND shop_id = $2`,
            [payload.runId, payload.shopId]
          );

          return {
            termIdsProcessed: termIds.length,
            contextsWritten: aggregate.rows.length,
            contextIdsTouched,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-build-contexts-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'build.contexts',
            status: 'completed',
            termIdsProcessed: result.termIdsProcessed,
            contextsWritten: result.contextsWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.termIdsProcessed,
          recordsWritten: result.contextsWritten,
          metadataPatch: {
            contextIdsTouched: result.contextIdsTouched,
          },
        }).catch(() => undefined);

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'build.contexts',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'build.contexts',
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
