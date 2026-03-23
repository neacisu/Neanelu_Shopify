import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { insertLexReviewOpenItemsBatch } from '../../services/lex-review-insert.js';
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
import { loadLexShopLangPair, parseTouchedIds } from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';
import {
  REVIEW_ENQUEUE_MAX_PAGES,
  REVIEW_ENQUEUE_PAGE_SIZE,
  REVIEW_ENQUEUE_UUID_ZERO,
  chunkLexReviewEnqueueIds,
} from './review-enqueue-pure.js';

async function enqueueReviewItemsForAmbiguousClusters(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  clusterIds: readonly string[];
}): Promise<number> {
  let created = 0;
  for (const idChunk of chunkLexReviewEnqueueIds(params.clusterIds, REVIEW_ENQUEUE_PAGE_SIZE)) {
    if (idChunk.length === 0) continue;
    const ambiguousClusters = await params.client.query<{
      id: string;
      confidenceScore: string | null;
    }>(
      `SELECT id, confidence_score AS "confidenceScore"
       FROM lex_sense_clusters
       WHERE id = ANY($1::uuid[])
         AND (needs_review = true OR COALESCE(confidence_score, 0) < 0.8500)`,
      [idChunk]
    );
    if (ambiguousClusters.rows.length === 0) continue;
    created += await insertLexReviewOpenItemsBatch({
      client: params.client,
      shopId: params.shopId,
      runId: params.runId,
      rows: ambiguousClusters.rows.map((cluster) => ({
        entityType: 'cluster',
        entityId: cluster.id,
        reviewReason: 'ambiguous',
        severity: 'high' as const,
        evidence: { confidenceScore: cluster.confidenceScore },
      })),
    });
  }
  return created;
}

async function enqueueReviewItemsForLowConfidenceTranslations(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  targetLang: string;
}): Promise<number> {
  let created = 0;
  let cursor = REVIEW_ENQUEUE_UUID_ZERO;
  for (let page = 0; page < REVIEW_ENQUEUE_MAX_PAGES; page += 1) {
    const translations = await params.client.query<{ id: string; qualityScore: string | null }>(
      `SELECT id, quality_score AS "qualityScore"
       FROM lex_translations
       WHERE shop_id = $1
         AND target_lang = $2
         AND COALESCE(quality_score, 0) < 0.9300
         AND id > $3::uuid
       ORDER BY id ASC
       LIMIT $4`,
      [params.shopId, params.targetLang, cursor, REVIEW_ENQUEUE_PAGE_SIZE]
    );
    if (translations.rows.length === 0) break;
    created += await insertLexReviewOpenItemsBatch({
      client: params.client,
      shopId: params.shopId,
      runId: params.runId,
      rows: translations.rows.map((translation) => ({
        entityType: 'translation',
        entityId: translation.id,
        reviewReason: 'low_confidence',
        severity: 'medium' as const,
        evidence: { qualityScore: translation.qualityScore },
      })),
    });
    cursor = translations.rows.at(-1)!.id;
    if (translations.rows.length < REVIEW_ENQUEUE_PAGE_SIZE) break;
  }
  return created;
}

async function enqueueReviewItemsForPendingAttributeCandidates(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
}): Promise<number> {
  let created = 0;
  let cursor = REVIEW_ENQUEUE_UUID_ZERO;
  for (let page = 0; page < REVIEW_ENQUEUE_MAX_PAGES; page += 1) {
    const unresolvedAttributeCandidates = await params.client.query<{ id: string }>(
      `SELECT id
       FROM lex_attribute_resolution_candidates
       WHERE shop_id = $1
         AND status = 'pending'
         AND created_at > now() - interval '7 days'
         AND id > $2::uuid
       ORDER BY id ASC
       LIMIT $3`,
      [params.shopId, cursor, REVIEW_ENQUEUE_PAGE_SIZE]
    );
    if (unresolvedAttributeCandidates.rows.length === 0) break;
    created += await insertLexReviewOpenItemsBatch({
      client: params.client,
      shopId: params.shopId,
      runId: params.runId,
      rows: unresolvedAttributeCandidates.rows.map((candidate) => ({
        entityType: 'attribute_resolution',
        entityId: candidate.id,
        reviewReason: 'unresolved_attribute',
        severity: 'medium' as const,
        evidence: {},
      })),
    });
    cursor = unresolvedAttributeCandidates.rows.at(-1)!.id;
    if (unresolvedAttributeCandidates.rows.length < REVIEW_ENQUEUE_PAGE_SIZE) break;
  }
  return created;
}

async function enqueueReviewItemsForDraftLocalizations(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  targetLang: string;
}): Promise<number> {
  let created = 0;
  let cursor = REVIEW_ENQUEUE_UUID_ZERO;
  for (let page = 0; page < REVIEW_ENQUEUE_MAX_PAGES; page += 1) {
    const localizations = await params.client.query<{ id: string; qualityScore: string | null }>(
      `SELECT id, quality_score AS "qualityScore"
       FROM lex_entity_localizations
       WHERE shop_id = $1
         AND publication_status = 'draft'
         AND target_lang = $2
         AND id > $3::uuid
       ORDER BY id ASC
       LIMIT $4`,
      [params.shopId, params.targetLang, cursor, REVIEW_ENQUEUE_PAGE_SIZE]
    );
    if (localizations.rows.length === 0) break;
    created += await insertLexReviewOpenItemsBatch({
      client: params.client,
      shopId: params.shopId,
      runId: params.runId,
      rows: localizations.rows.map((localization) => ({
        entityType: 'product',
        entityId: localization.id,
        reviewReason: 'low_confidence',
        severity: 'medium' as const,
        evidence: { qualityScore: localization.qualityScore },
      })),
    });
    cursor = localizations.rows.at(-1)!.id;
    if (localizations.rows.length < REVIEW_ENQUEUE_PAGE_SIZE) break;
  }
  return created;
}

async function runReviewEnqueueTenantWrites(params: {
  client: TenantClient;
  payload: LexShardJobPayload;
  shardMetadata: Record<string, unknown>;
}): Promise<{ reviewItemsCreated: number }> {
  const { targetLang } = await loadLexShopLangPair({
    client: params.client,
    shopId: params.payload.shopId,
  });

  const clusterIds = parseTouchedIds(params.shardMetadata, 'clusterIdsTouched');

  let reviewItemsCreated = 0;
  reviewItemsCreated += await enqueueReviewItemsForAmbiguousClusters({
    client: params.client,
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    clusterIds,
  });
  reviewItemsCreated += await enqueueReviewItemsForLowConfidenceTranslations({
    client: params.client,
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    targetLang,
  });
  reviewItemsCreated += await enqueueReviewItemsForPendingAttributeCandidates({
    client: params.client,
    shopId: params.payload.shopId,
    runId: params.payload.runId,
  });
  reviewItemsCreated += await enqueueReviewItemsForDraftLocalizations({
    client: params.client,
    shopId: params.payload.shopId,
    runId: params.payload.runId,
    targetLang,
  });

  return { reviewItemsCreated };
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

      const shardMetadata = shard.metadata;

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-review-enqueue-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) =>
          runReviewEnqueueTenantWrites({
            client,
            payload,
            shardMetadata,
          })
        );

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
        }).catch(() => undefined);

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
