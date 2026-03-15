import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_CLUSTER_SENSES_QUEUE_NAME,
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
import { decimalString, parseTouchedIds, sha256 } from './pipeline-utils.js';

type ContextRow = Readonly<{
  id: string;
  termId: string;
  representativeText: string;
  fieldKind: string | null;
  domainCode: string | null;
  taxonomyId: string | null;
  occurrencesCount: string;
}>;

type TermLabelRow = Readonly<{
  id: string;
  displayTextRo: string | null;
  canonicalText: string;
}>;

function buildGroupingKey(context: ContextRow): string {
  return [
    context.domainCode ?? 'domain:none',
    context.taxonomyId ?? 'taxonomy:none',
    context.fieldKind ?? 'field:none',
  ].join('|');
}

export function startLexClusterSensesWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_CLUSTER_SENSES_QUEUE_NAME,
    workerId: 'lex-cluster-senses-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_cluster_senses_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'cluster.senses') {
        throw new Error('invalid_lex_cluster_senses_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'cluster.senses') {
        return { termIdsProcessed: 0, clustersWritten: 0, clusterIdsTouched: [] };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-cluster-senses-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
          if (termIds.length === 0) {
            return { termIdsProcessed: 0, clustersWritten: 0, clusterIdsTouched: [] };
          }

          const terms = await client.query<TermLabelRow>(
            `SELECT id, display_text_ro AS "displayTextRo", canonical_text AS "canonicalText"
             FROM lex_terms
             WHERE id = ANY($1::uuid[])`,
            [termIds]
          );
          const termMap = new Map(terms.rows.map((term) => [term.id, term]));

          const contexts = await client.query<ContextRow>(
            `SELECT
               id,
               term_id AS "termId",
               representative_text AS "representativeText",
               field_kind AS "fieldKind",
               domain_code AS "domainCode",
               taxonomy_id::text AS "taxonomyId",
               occurrences_count::text AS "occurrencesCount"
             FROM lex_term_contexts
             WHERE shop_id = $1
               AND term_id = ANY($2::uuid[])
             ORDER BY term_id, occurrences_count DESC, created_at ASC`,
            [payload.shopId, termIds]
          );

          const contextsByTerm = new Map<string, ContextRow[]>();
          for (const context of contexts.rows) {
            const bucket = contextsByTerm.get(context.termId) ?? [];
            bucket.push(context);
            contextsByTerm.set(context.termId, bucket);
          }

          const clusterIdsTouched: string[] = [];
          for (const termId of termIds) {
            const termContexts = contextsByTerm.get(termId) ?? [];
            if (termContexts.length === 0) continue;

            const groups = new Map<string, ContextRow[]>();
            for (const context of termContexts) {
              const key = buildGroupingKey(context);
              const bucket = groups.get(key) ?? [];
              bucket.push(context);
              groups.set(key, bucket);
            }

            const label =
              termMap.get(termId)?.displayTextRo ?? termMap.get(termId)?.canonicalText ?? null;

            for (const [groupKey, members] of groups.entries()) {
              const representative = [...members].sort(
                (left, right) =>
                  Number(right.occurrencesCount || 0) - Number(left.occurrencesCount || 0)
              )[0]!;
              const clusterKey = `auto:${sha256(`${termId}:${groupKey}`).slice(0, 16)}`;
              const confidence = groups.size === 1 ? 0.96 : 0.72;

              const clusterRes = await client.query<{ id: string }>(
                `INSERT INTO lex_sense_clusters
                   (shop_id, term_id, cluster_key, cluster_method, domain_code, taxonomy_id, label_ro,
                    description, representative_context_id, confidence_score, needs_review, is_approved, created_at, updated_at)
                 VALUES
                   ($1, $2, $3, 'heuristic', $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
                 ON CONFLICT (shop_id, term_id, cluster_key)
                 DO UPDATE
                    SET domain_code = EXCLUDED.domain_code,
                        taxonomy_id = EXCLUDED.taxonomy_id,
                        label_ro = EXCLUDED.label_ro,
                        description = EXCLUDED.description,
                        representative_context_id = EXCLUDED.representative_context_id,
                        confidence_score = EXCLUDED.confidence_score,
                        needs_review = EXCLUDED.needs_review,
                        is_approved = EXCLUDED.is_approved,
                        updated_at = now()
                 RETURNING id`,
                [
                  payload.shopId,
                  termId,
                  clusterKey,
                  representative.domainCode,
                  representative.taxonomyId,
                  label,
                  representative.representativeText,
                  representative.id,
                  decimalString(confidence),
                  groups.size > 1,
                  groups.size === 1,
                ]
              );

              const clusterId = clusterRes.rows[0]!.id;
              clusterIdsTouched.push(clusterId);

              await client.query(
                `DELETE FROM lex_sense_cluster_members
                 WHERE cluster_id = $1`,
                [clusterId]
              );

              for (const member of members) {
                await client.query(
                  `INSERT INTO lex_sense_cluster_members
                     (cluster_id, context_id, similarity_score, is_representative, created_at)
                   VALUES
                     ($1, $2, $3, $4, now())
                   ON CONFLICT (cluster_id, context_id)
                   DO UPDATE
                      SET similarity_score = EXCLUDED.similarity_score,
                          is_representative = EXCLUDED.is_representative`,
                  [
                    clusterId,
                    member.id,
                    decimalString(member.id === representative.id ? 1 : 0.84),
                    member.id === representative.id,
                  ]
                );
              }
            }
          }

          await client.query(
            `UPDATE lex_runs
             SET sense_clusters_count = (
                   SELECT COUNT(*)
                   FROM lex_sense_clusters
                   WHERE shop_id = $2
                 ),
                 updated_at = now()
             WHERE id = $1
               AND shop_id = $2`,
            [payload.runId, payload.shopId]
          );

          return {
            termIdsProcessed: termIds.length,
            clustersWritten: clusterIdsTouched.length,
            clusterIdsTouched,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-cluster-senses-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'cluster.senses',
            status: 'completed',
            termIdsProcessed: result.termIdsProcessed,
            clustersWritten: result.clustersWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.termIdsProcessed,
          recordsWritten: result.clustersWritten,
          metadataPatch: {
            clusterIdsTouched: result.clusterIdsTouched,
          },
        });

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'cluster.senses',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'cluster.senses',
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
