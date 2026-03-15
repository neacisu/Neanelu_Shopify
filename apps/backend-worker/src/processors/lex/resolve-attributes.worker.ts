import type { Logger } from '@app/logger';
import type { LexResolveAttributesJobPayload, LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  enqueueLexShardJob,
  LEX_RESOLVE_ATTRIBUTES_JOB_NAME,
  LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
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
import { decimalString, normalizeLexeme, parseTouchedIds } from './pipeline-utils.js';

type ResolutionInputRow = Readonly<{
  termId: string;
  clusterId: string | null;
  canonicalText: string;
  normalizedKey: string;
}>;

async function processResolutionShard(params: {
  payload: LexShardJobPayload;
  logger: Logger;
}): Promise<{ candidatesWritten: number; resolutionsWritten: number; termIdsTouched: string[] }> {
  const shard = await loadLexShard({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
  });
  if (shard?.phaseName !== 'resolve.attributes') {
    return { candidatesWritten: 0, resolutionsWritten: 0, termIdsTouched: [] };
  }

  await markLexShardActive({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    workerName: 'lex-resolve-attributes-worker',
  });

  const result = await withTenantContext(params.payload.shopId, async (client) => {
    const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
    if (termIds.length === 0) {
      return { candidatesWritten: 0, resolutionsWritten: 0, termIdsTouched: [] };
    }

    const inputs = await client.query<ResolutionInputRow>(
      `SELECT
         t.id AS "termId",
         c.id AS "clusterId",
         t.canonical_text AS "canonicalText",
         t.normalized_key AS "normalizedKey"
       FROM lex_terms t
       LEFT JOIN lex_sense_clusters c
              ON c.term_id = t.id
             AND (c.shop_id = $1 OR c.shop_id IS NULL)
       WHERE t.id = ANY($2::uuid[])
         AND (t.shop_id = $1 OR t.shop_id IS NULL)`,
      [params.payload.shopId, termIds]
    );

    let candidatesWritten = 0;
    let resolutionsWritten = 0;
    for (const row of inputs.rows) {
      const exactDefinition = await client.query<{ id: string; label: string }>(
        `SELECT id, label
         FROM prod_attr_definitions
         WHERE LOWER(label) = LOWER($1)
         ORDER BY display_order ASC NULLS LAST, label ASC
         LIMIT 1`,
        [row.canonicalText]
      );

      const exactSynonym = !exactDefinition.rows[0]
        ? await client.query<{ definitionId: string }>(
            `SELECT definition_id AS "definitionId"
             FROM prod_attr_synonyms
             WHERE LOWER(synonym_text) = LOWER($1)
               AND is_approved = true
             ORDER BY confidence_score DESC NULLS LAST, created_at DESC
             LIMIT 1`,
            [row.canonicalText]
          )
        : { rows: [] };

      const definitionId =
        exactDefinition.rows[0]?.id ?? exactSynonym.rows[0]?.definitionId ?? null;
      const confidence = definitionId ? 0.98 : 0.41;
      const status = definitionId ? 'approved' : 'pending';

      const candidate = await client.query<{ id: string }>(
        `INSERT INTO lex_attribute_resolution_candidates
           (shop_id, term_id, cluster_id, definition_id, resolution_role, confidence_score, evidence, status, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, 'attribute_label', $5, $6::jsonb, $7, now(), now())
         RETURNING id`,
        [
          params.payload.shopId,
          row.termId,
          row.clusterId,
          definitionId,
          decimalString(confidence),
          JSON.stringify({
            sourceText: row.canonicalText,
            normalizedKey: row.normalizedKey,
            strategy: definitionId ? 'exact_match' : 'review_required',
          }),
          status,
        ]
      );
      candidatesWritten += 1;

      if (definitionId) {
        await client.query(
          `INSERT INTO lex_attribute_resolutions
             (shop_id, term_id, cluster_id, definition_id, resolution_role, source_candidate_id,
              confidence_score, status, approved_at, metadata, created_at, updated_at)
           VALUES
             ($1, $2, $3, $4, 'attribute_label', $5, $6, 'approved', now(), '{}'::jsonb, now(), now())
           ON CONFLICT (shop_id, term_id, cluster_id, definition_id, resolution_role)
           DO UPDATE
              SET source_candidate_id = EXCLUDED.source_candidate_id,
                  confidence_score = EXCLUDED.confidence_score,
                  status = 'approved',
                  approved_at = now(),
                  updated_at = now()`,
          [
            params.payload.shopId,
            row.termId,
            row.clusterId,
            definitionId,
            candidate.rows[0]?.id ?? null,
            decimalString(confidence),
          ]
        );
        resolutionsWritten += 1;

        const targetSnapshotHash = normalizeLexeme(`${definitionId}:${row.canonicalText}:en`);
        await client.query(
          `INSERT INTO lex_publication_targets
             (translation_id, localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
              target_snapshot_hash, status, payload, created_at, updated_at)
           SELECT
             NULL, NULL, $1, 'prod_attr_synonyms', $2, 'locale:en', $3, $4, 'pending', $5::jsonb, now(), now()
           WHERE NOT EXISTS (
             SELECT 1
             FROM lex_publication_targets
             WHERE shop_id = $1
               AND target_type = 'prod_attr_synonyms'
               AND target_record_id = $2
               AND target_snapshot_hash = $4
           )`,
          [
            params.payload.shopId,
            definitionId,
            `lex-target:prod_attr_synonyms:${definitionId}:${targetSnapshotHash}`,
            targetSnapshotHash,
            JSON.stringify({
              definitionId,
              synonymText: row.canonicalText,
              locale: 'en',
              source: 'lex_module',
              confidenceScore: confidence,
            }),
          ]
        );
      }
    }

    return {
      candidatesWritten,
      resolutionsWritten,
      termIdsTouched: [...new Set(inputs.rows.map((row) => row.termId))],
    };
  });

  await saveLexCheckpoint({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    workerName: 'lex-resolve-attributes-worker',
    checkpointType: 'phase_marker',
    checkpointValue: {
      phase: 'resolve.attributes',
      status: 'completed',
      candidatesWritten: result.candidatesWritten,
      resolutionsWritten: result.resolutionsWritten,
    },
  });

  await markLexShardCompleted({
    shopId: params.payload.shopId,
    shardId: params.payload.shardId,
    recordsRead: result.termIdsTouched.length,
    recordsWritten: result.candidatesWritten + result.resolutionsWritten,
    metadataPatch: {
      termIdsTouched: result.termIdsTouched,
    },
  });

  await recordLexPhaseEvent({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    shardId: params.payload.shardId,
    phaseName: 'resolve.attributes',
    eventType: 'shard_completed',
    details: result,
  });

  await advanceLexRunPhaseIfComplete({
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    phaseName: 'resolve.attributes',
    logger: params.logger,
  });

  return result;
}

export function startLexResolveAttributesWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
    workerId: 'lex-resolve-attributes-worker',
    processor: async (job) => {
      if (job.name === LEX_RESOLVE_ATTRIBUTES_JOB_NAME) {
        const payload = job.data as LexResolveAttributesJobPayload;
        await withTenantContext(payload.shopId, async (client) => {
          const pendingShards = await client.query<{ id: string }>(
            `SELECT id
             FROM lex_run_shards
             WHERE shop_id = $1
               AND run_id = $2
               AND phase_name = 'resolve.attributes'
               AND status = 'pending'
             ORDER BY created_at ASC`,
            [payload.shopId, payload.runId]
          );

          for (const shard of pendingShards.rows) {
            await enqueueLexShardJob(LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME, {
              shopId: payload.shopId,
              runId: payload.runId,
              shardId: shard.id,
              queuePhase: 'resolve.attributes',
              requestedAt: Date.now(),
            });
          }
        });

        return { enqueued: true };
      }

      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_resolve_attributes_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'resolve.attributes') {
        throw new Error('invalid_lex_resolve_attributes_shard_payload');
      }

      try {
        return await processResolutionShard({ payload, logger });
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
