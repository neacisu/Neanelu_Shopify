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
import { normalizeWhitespace, parseTouchedIds, uniqueStrings } from './pipeline-utils.js';

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
        const result = await withTenantContext(payload.shopId, async (client) => {
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
               MAX(f.field_kind) AS "fieldKind",
               MAX(f.vendor_hint) AS "vendorHint",
               MAX(f.product_type_hint) AS "productTypeHint",
               MAX(t.domain_code) AS "domainCode",
               MAX(f.taxonomy_id)::text AS "taxonomyId",
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT f.collection_id), NULL)::text[] AS "collectionIds",
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT f.product_id), NULL)::text[] AS "sampleProductIds",
               COUNT(*)::text AS "occurrencesCount"
             FROM lex_term_occurrences o
             INNER JOIN lex_fragments f
                     ON f.id = o.fragment_id
             INNER JOIN lex_terms t
                     ON t.id = o.term_id
             WHERE o.shop_id = $1
               AND o.term_id = ANY($2::uuid[])
             GROUP BY o.term_id, o.context_hash, t.display_text_ro, o.left_context, o.right_context`,
            [payload.shopId, termIds]
          );

          const contextIdsTouched: string[] = [];
          for (const row of aggregate.rows) {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO lex_term_contexts
                 (shop_id, term_id, representative_text, context_hash, field_kind, vendor_hint,
                  product_type_hint, domain_code, taxonomy_id, collection_ids, occurrences_count,
                  sample_product_ids, language_guess, created_at, updated_at)
               VALUES
                 ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[], $11, $12::uuid[], 'ro', now(), now())
               RETURNING id`,
              [
                payload.shopId,
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
              ]
            );
            if (inserted.rows[0]?.id) {
              contextIdsTouched.push(inserted.rows[0].id);
            }
          }

          await client.query(
            `UPDATE lex_runs
             SET contexts_count = (
                   SELECT COUNT(*)
                   FROM lex_term_contexts
                   WHERE shop_id = $2
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
        });

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
