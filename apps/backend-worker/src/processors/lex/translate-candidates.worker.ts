import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_SHARD_PROCESS_JOB_NAME,
  LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
} from '../../queue/lex-queues.js';
import {
  advanceLexRunPhaseIfComplete,
  loadLexShard,
  markLexRunPaused,
  markLexShardActive,
  markLexShardCompleted,
  markLexShardFailed,
  recordLexPhaseEvent,
} from './run-lifecycle.js';
import { saveLexCheckpoint } from './checkpoints.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';
import { decimalString, normalizeLexeme, parseTouchedIds } from './pipeline-utils.js';
import { BudgetExceededError, processLexTranslationBatch } from './ai-batches.js';

type ClusterRow = Readonly<{
  clusterId: string;
  termId: string;
  canonicalText: string;
  normalizedKey: string;
  domainCode: string | null;
  isTechnical: boolean | null;
  isProtected: boolean | null;
}>;

async function resolveTranslation(params: {
  client: {
    query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: TRow[] }>;
  };
  shopId: string;
  cluster: ClusterRow;
}): Promise<{
  candidateText: string;
  candidateSource: string;
  confidence: number;
  translationKind: string;
  evidence: Record<string, unknown>;
}> {
  const lockedGlossary = await params.client.query<{ targetText: string; translationKind: string }>(
    `SELECT target_text AS "targetText", translation_kind AS "translationKind"
     FROM lex_glossary_entries
     WHERE shop_id = $1
       AND normalized_source_text = $2
       AND source_lang = 'ro'
       AND target_lang = 'en'
       AND is_locked = true
       AND is_active = true
     ORDER BY priority ASC, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.cluster.normalizedKey]
  );
  if (lockedGlossary.rows[0]) {
    return {
      candidateText: lockedGlossary.rows[0].targetText,
      candidateSource: 'shop_glossary_locked',
      confidence: 0.99,
      translationKind: lockedGlossary.rows[0].translationKind,
      evidence: { strategy: 'shop_locked_glossary' },
    };
  }

  const globalGlossary = await params.client.query<{ targetText: string; translationKind: string }>(
    `SELECT target_text AS "targetText", translation_kind AS "translationKind"
     FROM lex_glossary_entries
     WHERE shop_id IS NULL
       AND normalized_source_text = $1
       AND source_lang = 'ro'
       AND target_lang = 'en'
       AND is_active = true
     ORDER BY priority ASC, updated_at DESC
     LIMIT 1`,
    [params.cluster.normalizedKey]
  );
  if (globalGlossary.rows[0]) {
    return {
      candidateText: globalGlossary.rows[0].targetText,
      candidateSource: 'global_glossary',
      confidence: 0.96,
      translationKind: globalGlossary.rows[0].translationKind,
      evidence: { strategy: 'global_glossary' },
    };
  }

  const rule = await params.client.query<{ targetTranslation: string }>(
    `SELECT target_translation AS "targetTranslation"
     FROM lex_translation_rules
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND source_lang = 'ro'
       AND target_lang = 'en'
       AND LOWER(match_term) = LOWER($2)
       AND is_active = true
     ORDER BY shop_id DESC NULLS LAST, priority ASC, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.cluster.canonicalText]
  );
  if (rule.rows[0]) {
    return {
      candidateText: rule.rows[0].targetTranslation,
      candidateSource: 'translation_rule',
      confidence: 0.95,
      translationKind: 'rule',
      evidence: { strategy: 'translation_rule' },
    };
  }

  const existing = await params.client.query<{
    translationText: string;
    qualityScore: string | null;
  }>(
    `SELECT translation_text AS "translationText", quality_score AS "qualityScore"
     FROM lex_translations
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND cluster_id = $2
       AND source_lang = 'ro'
       AND target_lang = 'en'
     ORDER BY approved_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.cluster.clusterId]
  );
  if (existing.rows[0]) {
    return {
      candidateText: existing.rows[0].translationText,
      candidateSource: 'existing_translation',
      confidence: Number(existing.rows[0].qualityScore ?? 0.9) || 0.9,
      translationKind: 'approved',
      evidence: { strategy: 'existing_translation' },
    };
  }

  if (params.cluster.isTechnical || params.cluster.isProtected) {
    return {
      candidateText: params.cluster.canonicalText,
      candidateSource: 'protected_passthrough',
      confidence: 0.94,
      translationKind: 'passthrough',
      evidence: { strategy: 'protected_passthrough' },
    };
  }

  const normalized = normalizeLexeme(params.cluster.canonicalText);
  return {
    candidateText:
      normalized === params.cluster.normalizedKey
        ? params.cluster.canonicalText
        : params.cluster.normalizedKey,
    candidateSource: 'ai_contextual_pending',
    confidence: 0.42,
    translationKind: 'candidate',
    evidence: { strategy: 'ai_batches_required' },
  };
}

export function startLexTranslateCandidatesWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
    workerId: 'lex-translate-candidates-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_translate_candidates_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'translate.candidates') {
        throw new Error('invalid_lex_translate_candidates_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'translate.candidates') {
        return {
          clustersProcessed: 0,
          candidatesWritten: 0,
          translationsWritten: 0,
          translationIdsTouched: [],
        };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-translate-candidates-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
          if (termIds.length === 0) {
            return {
              clustersProcessed: 0,
              candidatesWritten: 0,
              translationsWritten: 0,
              translationIdsTouched: [],
            };
          }

          const clusters = await client.query<ClusterRow>(
            `SELECT
               c.id AS "clusterId",
               c.term_id AS "termId",
               t.canonical_text AS "canonicalText",
               t.normalized_key AS "normalizedKey",
               c.domain_code AS "domainCode",
               t.is_technical AS "isTechnical",
               t.is_protected AS "isProtected"
             FROM lex_sense_clusters c
             INNER JOIN lex_terms t
                     ON t.id = c.term_id
             WHERE (c.shop_id = $1 OR c.shop_id IS NULL)
               AND c.term_id = ANY($2::uuid[])`,
            [payload.shopId, termIds]
          );

          const resolvedByCluster = new Map<
            string,
            {
              candidateText: string;
              candidateSource: string;
              confidence: number;
              translationKind: string;
              evidence: Record<string, unknown>;
            }
          >();

          const aiClusters: ClusterRow[] = [];
          for (const cluster of clusters.rows) {
            const resolved = await resolveTranslation({ client, shopId: payload.shopId, cluster });
            if (resolved.candidateSource === 'ai_contextual_pending') {
              aiClusters.push(cluster);
            } else {
              resolvedByCluster.set(cluster.clusterId, resolved);
            }
          }

          if (aiClusters.length > 0) {
            const aiBatch = await processLexTranslationBatch({
              shopId: payload.shopId,
              runId: payload.runId,
              clusters: aiClusters.map((cluster) => ({
                clusterId: cluster.clusterId,
                canonicalText: cluster.canonicalText,
                domainCode: cluster.domainCode,
              })),
            });

            for (const cluster of aiClusters) {
              const output = aiBatch.outputs.get(cluster.clusterId);
              if (!output) continue;
              resolvedByCluster.set(cluster.clusterId, {
                candidateText: output.candidateText,
                candidateSource: 'ai_contextual',
                confidence: output.confidence,
                translationKind: 'candidate',
                evidence: output.evidence,
              });
            }
          }

          const translationIdsTouched: string[] = [];
          let candidatesWritten = 0;
          let translationsWritten = 0;
          for (const cluster of clusters.rows) {
            const resolved = resolvedByCluster.get(cluster.clusterId);
            if (!resolved) continue;

            const candidate = await client.query<{ id: string }>(
              `INSERT INTO lex_translation_candidates
                 (shop_id, term_id, cluster_id, source_lang, target_lang, candidate_text, candidate_source,
                  confidence_score, justification, evidence, rank, status, created_at, updated_at)
               VALUES
                 ($1, $2, $3, 'ro', 'en', $4, $5, $6, $7, $8::jsonb, 1, $9, now(), now())
               RETURNING id`,
              [
                payload.shopId,
                cluster.termId,
                cluster.clusterId,
                resolved.candidateText,
                resolved.candidateSource,
                decimalString(resolved.confidence),
                `strategy=${resolved.candidateSource}`,
                JSON.stringify(resolved.evidence),
                resolved.confidence >= 0.93 ? 'approved' : 'pending',
              ]
            );
            candidatesWritten += 1;

            if (resolved.confidence >= 0.93) {
              const translation = await client.query<{ id: string }>(
                `INSERT INTO lex_translations
                   (shop_id, term_id, cluster_id, source_lang, target_lang, translation_text, translation_kind,
                    quality_score, source_candidate_id, publication_status, approved_at, created_at, updated_at)
                 VALUES
                   ($1, $2, $3, 'ro', 'en', $4, $5, $6, $7, 'draft', now(), now(), now())
                 ON CONFLICT (shop_id, term_id, cluster_id, source_lang, target_lang)
                 DO UPDATE
                    SET translation_text = EXCLUDED.translation_text,
                        translation_kind = EXCLUDED.translation_kind,
                        quality_score = EXCLUDED.quality_score,
                        source_candidate_id = EXCLUDED.source_candidate_id,
                        updated_at = now()
                 RETURNING id`,
                [
                  payload.shopId,
                  cluster.termId,
                  cluster.clusterId,
                  resolved.candidateText,
                  resolved.translationKind,
                  decimalString(resolved.confidence),
                  candidate.rows[0]?.id ?? null,
                ]
              );
              if (translation.rows[0]?.id) {
                translationIdsTouched.push(translation.rows[0].id);
                translationsWritten += 1;
              }
            }
          }

          await client.query(
            `UPDATE lex_runs
             SET translations_count = (
                   SELECT COUNT(*)
                   FROM lex_translations
                   WHERE shop_id = $2
                 ),
                 updated_at = now()
             WHERE id = $1
               AND shop_id = $2`,
            [payload.runId, payload.shopId]
          );

          return {
            clustersProcessed: clusters.rows.length,
            candidatesWritten,
            translationsWritten,
            translationIdsTouched,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-translate-candidates-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'translate.candidates',
            status: 'completed',
            clustersProcessed: result.clustersProcessed,
            candidatesWritten: result.candidatesWritten,
            translationsWritten: result.translationsWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.clustersProcessed,
          recordsWritten: result.candidatesWritten + result.translationsWritten,
          metadataPatch: {
            translationIdsTouched: result.translationIdsTouched,
          },
        });

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'translate.candidates',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'translate.candidates',
          logger,
        });

        return result;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await markLexRunPaused({
            shopId: payload.shopId,
            runId: payload.runId,
            pauseReason: 'budget_blocked',
            errorMessage: error.message,
          }).catch(() => undefined);
        }
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
