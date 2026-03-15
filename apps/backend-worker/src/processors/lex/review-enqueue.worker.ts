import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_REVIEW_ENQUEUE_QUEUE_NAME,
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
import { parseTouchedIds } from './pipeline-utils.js';

async function insertReviewItemIfMissing(params: {
  client: {
    query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: TRow[] }>;
  };
  shopId: string;
  runId: string;
  entityType: string;
  entityId: string;
  reviewReason: string;
  severity: 'medium' | 'high';
  evidence: Record<string, unknown>;
}): Promise<boolean> {
  const existing = await params.client.query<{ id: string }>(
    `SELECT id
     FROM lex_review_items
     WHERE shop_id = $1
       AND entity_type = $2
       AND entity_id = $3
       AND review_reason = $4
       AND status IN ('pending', 'in_review')
     LIMIT 1`,
    [params.shopId, params.entityType, params.entityId, params.reviewReason]
  );

  if (existing.rows[0]?.id) return false;

  await params.client.query(
    `INSERT INTO lex_review_items
       (shop_id, run_id, entity_type, entity_id, review_reason, severity, priority, status, evidence, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'high' THEN 50 ELSE 100 END, 'pending', $7::jsonb, now(), now())`,
    [
      params.shopId,
      params.runId,
      params.entityType,
      params.entityId,
      params.reviewReason,
      params.severity,
      JSON.stringify(params.evidence),
    ]
  );
  return true;
}

export function startLexReviewEnqueueWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_REVIEW_ENQUEUE_QUEUE_NAME,
    workerId: 'lex-review-enqueue-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_review_enqueue_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'review.enqueue') {
        throw new Error('invalid_lex_review_enqueue_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'review.enqueue') {
        return { reviewItemsCreated: 0 };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-review-enqueue-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          let reviewItemsCreated = 0;

          const clusterIds = parseTouchedIds(shard.metadata, 'clusterIdsTouched');
          if (clusterIds.length > 0) {
            const ambiguousClusters = await client.query<{
              id: string;
              confidenceScore: string | null;
            }>(
              `SELECT id, confidence_score AS "confidenceScore"
               FROM lex_sense_clusters
               WHERE id = ANY($1::uuid[])
                 AND (needs_review = true OR COALESCE(confidence_score, 0) < 0.8500)`,
              [clusterIds]
            );

            for (const cluster of ambiguousClusters.rows) {
              if (
                await insertReviewItemIfMissing({
                  client,
                  shopId: payload.shopId,
                  runId: payload.runId,
                  entityType: 'cluster',
                  entityId: cluster.id,
                  reviewReason: 'ambiguous',
                  severity: 'high',
                  evidence: {
                    confidenceScore: cluster.confidenceScore,
                  },
                })
              ) {
                reviewItemsCreated += 1;
              }
            }
          }

          const translations = await client.query<{ id: string; qualityScore: string | null }>(
            `SELECT id, quality_score AS "qualityScore"
             FROM lex_translations
             WHERE shop_id = $1
               AND target_lang = 'en'
               AND COALESCE(quality_score, 0) < 0.9300`,
            [payload.shopId]
          );

          for (const translation of translations.rows) {
            if (
              await insertReviewItemIfMissing({
                client,
                shopId: payload.shopId,
                runId: payload.runId,
                entityType: 'translation',
                entityId: translation.id,
                reviewReason: 'low_confidence',
                severity: 'medium',
                evidence: {
                  qualityScore: translation.qualityScore,
                },
              })
            ) {
              reviewItemsCreated += 1;
            }
          }

          const unresolvedAttributeCandidates = await client.query<{ id: string }>(
            `SELECT id
             FROM lex_attribute_resolution_candidates
             WHERE shop_id = $1
               AND status = 'pending'
               AND created_at > now() - interval '7 days'`,
            [payload.shopId]
          );

          for (const candidate of unresolvedAttributeCandidates.rows) {
            if (
              await insertReviewItemIfMissing({
                client,
                shopId: payload.shopId,
                runId: payload.runId,
                entityType: 'attribute_resolution',
                entityId: candidate.id,
                reviewReason: 'unresolved_attribute',
                severity: 'medium',
                evidence: {},
              })
            ) {
              reviewItemsCreated += 1;
            }
          }

          const localizations = await client.query<{ id: string; qualityScore: string | null }>(
            `SELECT id, quality_score AS "qualityScore"
             FROM lex_entity_localizations
             WHERE shop_id = $1
               AND publication_status = 'draft'
               AND target_lang = 'en'`,
            [payload.shopId]
          );

          for (const localization of localizations.rows) {
            if (
              await insertReviewItemIfMissing({
                client,
                shopId: payload.shopId,
                runId: payload.runId,
                entityType: 'product',
                entityId: localization.id,
                reviewReason: 'low_confidence',
                severity: 'medium',
                evidence: {
                  qualityScore: localization.qualityScore,
                },
              })
            ) {
              reviewItemsCreated += 1;
            }
          }

          return { reviewItemsCreated };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-review-enqueue-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'review.enqueue',
            status: 'completed',
            reviewItemsCreated: result.reviewItemsCreated,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.reviewItemsCreated,
          recordsWritten: result.reviewItemsCreated,
        });

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'review.enqueue',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'review.enqueue',
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
