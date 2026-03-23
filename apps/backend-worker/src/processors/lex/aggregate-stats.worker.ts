import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_AGGREGATE_STATS_QUEUE_NAME,
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
import { decimalString, parseTouchedIds } from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';

type TermStatsRow = Readonly<{
  termId: string;
  occurrencesTotal: string;
  distinctFragments: string;
  distinctProducts: string;
  distinctVariants: string;
  distinctCollections: string;
  titleOccurrences: string;
  descriptionOccurrences: string;
  metafieldOccurrences: string;
  vendorOccurrences: string;
}>;

function scoreFromStats(row: TermStatsRow): number {
  const occurrences = Number(row.occurrencesTotal || 0);
  const fragments = Number(row.distinctFragments || 0);
  const titles = Number(row.titleOccurrences || 0);
  const descriptions = Number(row.descriptionOccurrences || 0);
  const vendor = Number(row.vendorOccurrences || 0);
  return occurrences * 0.4 + fragments * 0.3 + titles * 1.2 + descriptions * 0.5 + vendor * 0.2;
}

const LEX_TERM_STATS_UPSERT_BATCH = 100;

async function batchUpsertLexTermStats(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  rows: readonly TermStatsRow[];
}): Promise<void> {
  const { client, shopId, runId, rows } = params;
  if (rows.length === 0) {
    return;
  }

  for (let offset = 0; offset < rows.length; offset += LEX_TERM_STATS_UPSERT_BATCH) {
    const chunk = rows.slice(offset, offset + LEX_TERM_STATS_UPSERT_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const row of chunk) {
      const scoreGlobal = scoreFromStats(row);
      const scoreTfidf = Number(row.occurrencesTotal || 0) * 0.25;
      const scoreDomain =
        Number(row.titleOccurrences || 0) * 0.8 +
        Number(row.descriptionOccurrences || 0) * 0.3 +
        Number(row.metafieldOccurrences || 0) * 0.5;
      placeholders.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, now())`
      );
      values.push(
        shopId,
        row.termId,
        runId,
        Number(row.occurrencesTotal || 0),
        Number(row.distinctFragments || 0),
        Number(row.distinctProducts || 0),
        Number(row.distinctVariants || 0),
        Number(row.distinctCollections || 0),
        Number(row.titleOccurrences || 0),
        Number(row.descriptionOccurrences || 0),
        Number(row.metafieldOccurrences || 0),
        Number(row.vendorOccurrences || 0),
        decimalString(scoreGlobal),
        decimalString(scoreTfidf),
        decimalString(scoreDomain)
      );
    }

    await client.query(
      `INSERT INTO lex_term_stats
         (shop_id, term_id, last_run_id, occurrences_total, distinct_fragments, distinct_products,
          distinct_variants, distinct_collections, title_occurrences, description_occurrences,
          metafield_occurrences, vendor_occurrences, score_global, score_tfidf, score_domain, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (shop_id, term_id)
       DO UPDATE
          SET last_run_id = EXCLUDED.last_run_id,
              occurrences_total = EXCLUDED.occurrences_total,
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
      values
    );
  }
}

export function startLexAggregateStatsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_AGGREGATE_STATS_QUEUE_NAME,
    workerId: 'lex-aggregate-stats-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_aggregate_stats_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'aggregate.stats') {
        throw new Error('invalid_lex_aggregate_stats_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'aggregate.stats') {
        return { termIdsProcessed: 0, statsWritten: 0, termIdsTouched: [] };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-aggregate-stats-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
          if (termIds.length === 0) {
            return { termIdsProcessed: 0, statsWritten: 0, termIdsTouched: [] };
          }

          const stats = await client.query<TermStatsRow>(
            `SELECT
               o.term_id AS "termId",
               COUNT(*)::text AS "occurrencesTotal",
               COUNT(DISTINCT o.fragment_id)::text AS "distinctFragments",
               COUNT(DISTINCT f.product_id)::text AS "distinctProducts",
               COUNT(DISTINCT f.variant_id)::text AS "distinctVariants",
               COUNT(DISTINCT f.collection_id)::text AS "distinctCollections",
               COUNT(*) FILTER (WHERE f.field_kind = 'title')::text AS "titleOccurrences",
               COUNT(*) FILTER (WHERE f.field_kind = 'description')::text AS "descriptionOccurrences",
               COUNT(*) FILTER (WHERE f.field_kind = 'metafield')::text AS "metafieldOccurrences",
               COUNT(*) FILTER (WHERE f.field_kind = 'vendor')::text AS "vendorOccurrences"
             FROM lex_term_occurrences o
             INNER JOIN lex_fragments f
                     ON f.id = o.fragment_id
             WHERE o.shop_id = $1
               AND f.shop_id = $1
               AND f.run_id = $3
               AND o.term_id = ANY($2::uuid[])
             GROUP BY o.term_id`,
            [payload.shopId, termIds, payload.runId]
          );

          await batchUpsertLexTermStats({
            client,
            shopId: payload.shopId,
            runId: payload.runId,
            rows: stats.rows,
          });

          await client.query(
            `UPDATE lex_runs
             SET terms_count = (
                   SELECT COUNT(DISTINCT o.term_id)::bigint
                   FROM lex_term_occurrences o
                   INNER JOIN lex_fragments f ON f.id = o.fragment_id
                   WHERE f.run_id = $1
                     AND f.shop_id = $2
                 ),
                 updated_at = now()
             WHERE id = $1
               AND shop_id = $2`,
            [payload.runId, payload.shopId]
          );

          return {
            termIdsProcessed: termIds.length,
            statsWritten: stats.rows.length,
            termIdsTouched: termIds,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-aggregate-stats-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'aggregate.stats',
            status: 'completed',
            termIdsProcessed: result.termIdsProcessed,
            statsWritten: result.statsWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.termIdsProcessed,
          recordsWritten: result.statsWritten,
          metadataPatch: {
            statsUpdatedForTermIds: result.termIdsTouched,
          },
        }).catch(() => undefined);

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'aggregate.stats',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'aggregate.stats',
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
