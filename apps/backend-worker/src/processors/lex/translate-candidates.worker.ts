import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { resolveEmbeddingsProvider } from '../../services/ai-provider-routing.js';
import {
  computeLexGlossaryRulesSnapshotHash,
  readGlossaryRulesSnapshotHashFromRunMetadata,
} from '../../services/lex-glossary-rules-snapshot.js';
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
import {
  decimalString,
  normalizeLexeme,
  parseLexShopLangFromSettingsRow,
  parseTouchedIds,
} from './pipeline-utils.js';
import { summarizeConfidenceDistribution } from './pipeline-pure-fns.js';
import { toPgVectorLiteral } from '../bulk-operations/pim/vector.js';
import { insertLexReviewOpenItemsBatch } from '../../services/lex-review-insert.js';
import {
  BudgetExceededError,
  processLexTranslationBatch,
  processLexTranslationQualityAudit,
  syncLexTranslationSourceEmbeddings,
  type LexTranslationAuditInput,
} from './ai-batches.js';

/**
 * Calibrare praguri de calitate (f5-01), după primele rulari reale cu LLM:
 * 1. Rulează faza translate.candidates pe un set reprezentativ de shard-uri.
 * 2. Interoghează `lex_run_phase_events` pentru `event_type = 'translate_candidates_confidence'`
 *    și compară min/max/medie/mediană cu eșantionare umană (review).
 * 3. Ajustează în `lex_shop_settings`: `translation_auto_approve_threshold` (auto-aprobare la nivel
 *    de termen / TM), `consensus_escalation_threshold` (escaladare consensus în modul auto),
 *    și `localization_auto_approve_threshold` (poartă pentru publicarea localizărilor compuse).
 * Valorile implicite (0.93 / 0.80 / 0.85) sunt puncte de plecare; reglare per magazin după date și review.
 */

type ClusterRow = Readonly<{
  clusterId: string;
  termId: string;
  canonicalText: string;
  normalizedKey: string;
  domainCode: string | null;
  isTechnical: boolean | null;
  isProtected: boolean | null;
}>;

type LangPair = Readonly<{ sourceLang: string; targetLang: string }>;

interface TranslateCandidatesDbClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TRow[] }>;
}

type ResolvedTranslationEntry = Readonly<{
  candidateText: string;
  candidateSource: string;
  confidence: number;
  translationKind: string;
  evidence: Record<string, unknown>;
}>;

type TranslateCandidatesBundle = Readonly<{
  clusters: readonly ClusterRow[];
  langs: LangPair;
  tmEnabled: boolean;
  tmThreshold: number;
  qualityAuditEnabled: boolean;
  qualityAuditMinBatchSize: number;
  translationAutoApproveThreshold: number;
}>;

type LoadedLexShard = NonNullable<Awaited<ReturnType<typeof loadLexShard>>>;

type TranslateCandidatesDbPhaseResult = Readonly<{
  clustersProcessed: number;
  candidatesWritten: number;
  translationsWritten: number;
  translationIdsTouched: readonly string[];
  tmHits: number;
  tmMisses: number;
  tmSimilaritySum: number;
  auditInputs: readonly LexTranslationAuditInput[];
  confidenceDistribution: ReturnType<typeof summarizeConfidenceDistribution>;
  guardrailReviewItemsCreated?: number;
}>;

/** Metrics-only payload when the shard is not in `translate.candidates` (no-op). */
type TranslateCandidatesSkippedPhaseResult = Readonly<{
  clustersProcessed: number;
  candidatesWritten: number;
  translationsWritten: number;
  translationIdsTouched: readonly string[];
  tmHits: number;
  tmMisses: number;
  tmSimilaritySum: number;
}>;

type LexShardProcessJob = Readonly<{
  name: string;
  data: unknown;
}>;

async function tryResolveTranslationMemory(params: {
  client: TranslateCandidatesDbClient;
  shopId: string;
  sourceLang: string;
  targetLang: string;
  translationAutoApproveThreshold: number;
  tm: Readonly<{
    threshold: number;
    vector: readonly number[];
    stats: { hits: number; misses: number; similaritySum: number };
  }>;
}): Promise<ResolvedTranslationEntry | null> {
  const vecLiteral = toPgVectorLiteral(params.tm.vector);
  const mem = await params.client.query<{
    translationText: string;
    similarity: string | null;
  }>(
    `SELECT
       translation_text AS "translationText",
       (1 - (source_embedding <=> $2::vector(2000)))::text AS "similarity"
     FROM lex_translations
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND source_embedding IS NOT NULL
       AND publication_status IN ('approved', 'draft')
       AND quality_score >= $5::numeric
       AND source_lang = $3
       AND target_lang = $4
     ORDER BY source_embedding <=> $2::vector(2000)
     LIMIT 5`,
    [
      params.shopId,
      vecLiteral,
      params.sourceLang,
      params.targetLang,
      decimalString(params.translationAutoApproveThreshold),
    ]
  );
  const best =
    mem.rows.find((row) => {
      const sim = Number(row.similarity ?? 0);
      return Number.isFinite(sim) && sim >= params.tm.threshold;
    }) ?? null;
  if (!best) {
    params.tm.stats.misses += 1;
    return null;
  }
  params.tm.stats.hits += 1;
  const sim = Number(best.similarity);
  if (Number.isFinite(sim)) {
    params.tm.stats.similaritySum += sim;
  }
  return {
    candidateText: best.translationText,
    candidateSource: 'translation_memory',
    confidence: params.translationAutoApproveThreshold,
    translationKind: 'translation_memory',
    evidence: {
      strategy: 'translation_memory',
      cosineSimilarity: Number.isFinite(sim) ? sim : null,
      threshold: params.tm.threshold,
    },
  };
}

async function resolveTranslation(params: {
  client: TranslateCandidatesDbClient;
  shopId: string;
  cluster: ClusterRow;
  langs: LangPair;
  translationAutoApproveThreshold: number;
  tm?: Readonly<{
    enabled: boolean;
    threshold: number;
    vector: readonly number[] | null;
    stats: { hits: number; misses: number; similaritySum: number };
  }>;
}): Promise<{
  candidateText: string;
  candidateSource: string;
  confidence: number;
  translationKind: string;
  evidence: Record<string, unknown>;
}> {
  const { sourceLang, targetLang } = params.langs;

  const lockedGlossary = await params.client.query<{ targetText: string; translationKind: string }>(
    `SELECT target_text AS "targetText", translation_kind AS "translationKind"
     FROM lex_glossary_entries
     WHERE shop_id = $1
       AND normalized_source_text = $2
       AND source_lang = $3
       AND target_lang = $4
       AND is_locked = true
       AND is_active = true
     ORDER BY priority ASC, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.cluster.normalizedKey, sourceLang, targetLang]
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
       AND source_lang = $2
       AND target_lang = $3
       AND is_active = true
     ORDER BY priority ASC, updated_at DESC
     LIMIT 1`,
    [params.cluster.normalizedKey, sourceLang, targetLang]
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
       AND source_lang = $2
       AND target_lang = $3
       AND LOWER(match_term) = LOWER($4)
       AND is_active = true
     ORDER BY shop_id DESC NULLS LAST, priority ASC, updated_at DESC
     LIMIT 1`,
    [params.shopId, sourceLang, targetLang, params.cluster.canonicalText]
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
       AND source_lang = $3
       AND target_lang = $4
     ORDER BY approved_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [params.shopId, params.cluster.clusterId, sourceLang, targetLang]
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

  const tm = params.tm;
  if (tm?.enabled === true && tm.vector?.length === 2000 && Number.isFinite(tm.threshold)) {
    const hit = await tryResolveTranslationMemory({
      client: params.client,
      shopId: params.shopId,
      sourceLang,
      targetLang,
      translationAutoApproveThreshold: params.translationAutoApproveThreshold,
      tm: {
        threshold: tm.threshold,
        vector: tm.vector,
        stats: tm.stats,
      },
    });
    if (hit) {
      return hit;
    }
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

function emptyTranslateCandidatesDbPhaseResult(): TranslateCandidatesDbPhaseResult {
  return {
    clustersProcessed: 0,
    candidatesWritten: 0,
    translationsWritten: 0,
    translationIdsTouched: [],
    tmHits: 0,
    tmMisses: 0,
    tmSimilaritySum: 0,
    auditInputs: [] as LexTranslationAuditInput[],
    confidenceDistribution: summarizeConfidenceDistribution([]),
  };
}

async function loadTranslateCandidatesWorkerBundle(
  payload: LexShardJobPayload,
  shard: LoadedLexShard,
  logger: Logger
): Promise<TranslateCandidatesBundle> {
  return withTenantContext(payload.shopId, async (client) => {
    const runMetaRow = await client.query<{ metadata: unknown }>(
      `SELECT metadata
       FROM lex_runs
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
      [payload.runId, payload.shopId]
    );
    const expectedGlossaryRulesHash = readGlossaryRulesSnapshotHashFromRunMetadata(
      runMetaRow.rows[0]?.metadata
    );
    if (expectedGlossaryRulesHash) {
      const currentGlossaryRulesHash = await computeLexGlossaryRulesSnapshotHash(
        client,
        payload.shopId
      );
      if (currentGlossaryRulesHash !== expectedGlossaryRulesHash) {
        await recordLexPhaseEvent({
          client,
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'translate.candidates',
          eventType: 'glossary_rules_stale',
          details: {
            expectedSnapshotHash: expectedGlossaryRulesHash,
            currentSnapshotHash: currentGlossaryRulesHash,
          },
        });
        logger.warn(
          {
            shopId: payload.shopId,
            runId: payload.runId,
            shardId: payload.shardId,
            expectedSnapshotHash: expectedGlossaryRulesHash,
            currentSnapshotHash: currentGlossaryRulesHash,
          },
          'lex_glossary_rules_changed_mid_run'
        );
      }
    }

    const settings = await client.query<{
      sourceLang: string;
      targetLangs: string[] | null;
      tmEnabled: boolean | null;
      tmSimilarityThreshold: string | null;
      qualityAuditEnabled: boolean | null;
      qualityAuditMinBatchSize: number | null;
      translationAutoApproveThreshold: string | null;
    }>(
      `SELECT
         source_lang AS "sourceLang",
         target_langs AS "targetLangs",
         tm_enabled AS "tmEnabled",
         tm_similarity_threshold::text AS "tmSimilarityThreshold",
         quality_audit_enabled AS "qualityAuditEnabled",
         quality_audit_min_batch_size AS "qualityAuditMinBatchSize",
         translation_auto_approve_threshold::text AS "translationAutoApproveThreshold"
       FROM lex_shop_settings
       WHERE shop_id = $1
       LIMIT 1`,
      [payload.shopId]
    );
    const s = settings.rows[0];
    const langs: LangPair = parseLexShopLangFromSettingsRow(s);
    const tmEnabled = s?.tmEnabled !== false;
    const tmThreshold = Math.max(0, Math.min(1, Number(s?.tmSimilarityThreshold ?? 0.92)));
    const qualityAuditEnabled = s?.qualityAuditEnabled !== false;
    const qualityAuditMinBatchSize = Math.max(
      1,
      Math.min(5000, Number(s?.qualityAuditMinBatchSize ?? 50))
    );
    const translationAutoApproveThreshold = Math.max(
      0,
      Math.min(1, Number(s?.translationAutoApproveThreshold ?? 0.93))
    );

    const termIds = parseTouchedIds(shard.metadata, 'termIdsTouched');
    if (termIds.length === 0) {
      return {
        clusters: [] as ClusterRow[],
        langs,
        tmEnabled,
        tmThreshold,
        qualityAuditEnabled,
        qualityAuditMinBatchSize,
        translationAutoApproveThreshold,
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

    return {
      clusters: clusters.rows,
      langs,
      tmEnabled,
      tmThreshold,
      qualityAuditEnabled,
      qualityAuditMinBatchSize,
      translationAutoApproveThreshold,
    };
  });
}

async function buildTmEmbeddingMapForTranslateCandidates(
  payload: LexShardJobPayload,
  bundle: TranslateCandidatesBundle,
  env: ReturnType<typeof loadEnv>,
  logger: Logger
): Promise<Map<number, readonly number[]> | null> {
  if (!bundle.tmEnabled || bundle.clusters.length === 0) {
    return null;
  }
  const embedder = await resolveEmbeddingsProvider({
    shopId: payload.shopId,
    env,
    logger,
  });
  if (!embedder.isAvailable()) {
    return null;
  }
  const embeddableIndices: number[] = [];
  const embeddableTexts: string[] = [];
  for (let idx = 0; idx < bundle.clusters.length; idx += 1) {
    const text = bundle.clusters[idx]!.canonicalText?.trim();
    if (text && text.length > 0) {
      embeddableIndices.push(idx);
      embeddableTexts.push(text);
    }
  }
  if (embeddableTexts.length === 0) {
    return null;
  }
  try {
    const rawVectors = await embedder.embedTexts(embeddableTexts);
    const tmVectorsByIndex = new Map<number, readonly number[]>();
    for (let j = 0; j < embeddableIndices.length; j += 1) {
      const vec = rawVectors[j];
      if (vec) {
        tmVectorsByIndex.set(embeddableIndices[j]!, vec);
      }
    }
    return tmVectorsByIndex;
  } catch (error) {
    logger.warn(
      {
        shopId: payload.shopId,
        err: error instanceof Error ? error.message : String(error),
      },
      'lex_tm_embedding_batch_failed'
    );
    return null;
  }
}

async function resolveTranslationsForClustersLoop(params: {
  client: TranslateCandidatesDbClient;
  payload: LexShardJobPayload;
  bundle: TranslateCandidatesBundle;
  tmVectorsByIndex: Map<number, readonly number[]> | null;
  tmStats: { hits: number; misses: number; similaritySum: number };
  logger: Logger;
}): Promise<{
  resolvedByCluster: Map<string, ResolvedTranslationEntry>;
  aiClusters: ClusterRow[];
}> {
  const { client, payload, bundle, tmVectorsByIndex, tmStats, logger } = params;
  const resolvedByCluster = new Map<string, ResolvedTranslationEntry>();
  const aiClusters: ClusterRow[] = [];

  for (let i = 0; i < bundle.clusters.length; i += 1) {
    const cluster = bundle.clusters[i]!;
    if (!cluster.canonicalText?.trim()) {
      logger.warn(
        { shopId: payload.shopId, clusterId: cluster.clusterId },
        'empty_canonical_skipped'
      );
      continue;
    }
    const vec = tmVectorsByIndex?.get(i) ?? null;
    const tmArg =
      bundle.tmEnabled && vec?.length === 2000
        ? {
            enabled: true as const,
            threshold: bundle.tmThreshold,
            vector: vec,
            stats: tmStats,
          }
        : null;
    const resolved = await resolveTranslation(
      tmArg
        ? {
            client,
            shopId: payload.shopId,
            cluster,
            langs: bundle.langs,
            translationAutoApproveThreshold: bundle.translationAutoApproveThreshold,
            tm: tmArg,
          }
        : {
            client,
            shopId: payload.shopId,
            cluster,
            langs: bundle.langs,
            translationAutoApproveThreshold: bundle.translationAutoApproveThreshold,
          }
    );
    if (resolved.candidateSource === 'ai_contextual_pending') {
      aiClusters.push(cluster);
    } else {
      resolvedByCluster.set(cluster.clusterId, resolved);
    }
  }

  return { resolvedByCluster, aiClusters };
}

async function mergeLexAiTranslationBatchOutputs(params: {
  resolvedByCluster: Map<string, ResolvedTranslationEntry>;
  aiClusters: readonly ClusterRow[];
  payload: LexShardJobPayload;
  env: ReturnType<typeof loadEnv>;
  logger: Logger;
}): Promise<void> {
  const { resolvedByCluster, aiClusters, payload, env, logger } = params;
  if (aiClusters.length === 0) {
    return;
  }

  const aiBatch = await processLexTranslationBatch({
    shopId: payload.shopId,
    runId: payload.runId,
    env,
    logger,
    clusters: aiClusters.map((cluster) => ({
      clusterId: cluster.clusterId,
      termId: cluster.termId,
      canonicalText: cluster.canonicalText,
      domainCode: cluster.domainCode,
    })),
  });

  for (const cluster of aiClusters) {
    const output = aiBatch.outputs.get(cluster.clusterId);
    if (!output) {
      continue;
    }
    resolvedByCluster.set(cluster.clusterId, {
      candidateText: output.candidateText,
      candidateSource: output.candidateSource,
      confidence: output.confidence,
      translationKind: 'candidate',
      evidence: output.evidence,
    });
  }
}

async function stripGuardrailBlockedClusters(params: {
  client: TranslateCandidatesDbClient;
  payload: LexShardJobPayload;
  bundle: TranslateCandidatesBundle;
  resolvedByCluster: Map<string, ResolvedTranslationEntry>;
}): Promise<number> {
  const { client, payload, bundle, resolvedByCluster } = params;
  const guardrailBlockedReviewRows: {
    entityType: string;
    entityId: string;
    reviewReason: string;
    severity: 'high';
    evidence: Record<string, unknown>;
  }[] = [];

  for (const cluster of bundle.clusters) {
    const resolved = resolvedByCluster.get(cluster.clusterId);
    if (resolved?.candidateSource === 'guardrail_blocked') {
      guardrailBlockedReviewRows.push({
        entityType: 'sense_cluster',
        entityId: cluster.clusterId,
        reviewReason: 'guardrail_blocked_output',
        severity: 'high',
        evidence: {
          termId: cluster.termId,
          canonicalText: cluster.canonicalText,
          domainCode: cluster.domainCode,
          ...resolved.evidence,
        },
      });
      resolvedByCluster.delete(cluster.clusterId);
    }
  }

  if (guardrailBlockedReviewRows.length === 0) {
    return 0;
  }

  return await insertLexReviewOpenItemsBatch({
    client,
    shopId: payload.shopId,
    runId: payload.runId,
    rows: guardrailBlockedReviewRows,
  });
}

function collectTranslateConfidenceSamples(
  bundle: TranslateCandidatesBundle,
  resolvedByCluster: ReadonlyMap<string, ResolvedTranslationEntry>
): number[] {
  const confidenceSamples: number[] = [];
  for (const c of bundle.clusters) {
    if (!c.canonicalText?.trim()) {
      continue;
    }
    const r = resolvedByCluster.get(c.clusterId);
    if (r) {
      confidenceSamples.push(r.confidence);
    }
  }
  return confidenceSamples;
}

async function upsertLexClusterCandidateAndTranslation(params: {
  client: TranslateCandidatesDbClient;
  payload: LexShardJobPayload;
  bundle: TranslateCandidatesBundle;
  cluster: ClusterRow;
  resolved: ResolvedTranslationEntry;
  approveAt: number;
  aiClusterIdSet: ReadonlySet<string>;
}): Promise<{
  translationId: string | null;
  auditInput: LexTranslationAuditInput | null;
}> {
  const { client, payload, bundle, cluster, resolved, approveAt, aiClusterIdSet } = params;

  const candidate = await client.query<{ id: string }>(
    `INSERT INTO lex_translation_candidates
       (shop_id, term_id, cluster_id, source_lang, target_lang, candidate_text, candidate_source,
        confidence_score, justification, evidence, rank, status, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 1, $11, now(), now())
     ON CONFLICT (shop_id, term_id, COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid), source_lang, target_lang, rank)
     DO UPDATE SET
       candidate_text = EXCLUDED.candidate_text,
       candidate_source = EXCLUDED.candidate_source,
       confidence_score = EXCLUDED.confidence_score,
       justification = EXCLUDED.justification,
       evidence = EXCLUDED.evidence,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING id`,
    [
      payload.shopId,
      cluster.termId,
      cluster.clusterId,
      bundle.langs.sourceLang,
      bundle.langs.targetLang,
      resolved.candidateText,
      resolved.candidateSource,
      decimalString(resolved.confidence),
      `strategy=${resolved.candidateSource}`,
      JSON.stringify(resolved.evidence),
      resolved.confidence >= approveAt ? 'approved' : 'pending',
    ]
  );

  if (resolved.confidence < approveAt) {
    return { translationId: null, auditInput: null };
  }

  const translation = await client.query<{ id: string }>(
    `INSERT INTO lex_translations
       (shop_id, term_id, cluster_id, source_lang, target_lang, translation_text, translation_kind,
        quality_score, source_candidate_id, publication_status, approved_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', now(), now(), now())
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
      bundle.langs.sourceLang,
      bundle.langs.targetLang,
      resolved.candidateText,
      resolved.translationKind,
      decimalString(resolved.confidence),
      candidate.rows[0]?.id ?? null,
    ]
  );

  const translationId = translation.rows[0]?.id ?? null;
  if (!translationId) {
    return { translationId: null, auditInput: null };
  }

  if (
    !aiClusterIdSet.has(cluster.clusterId) ||
    !bundle.qualityAuditEnabled ||
    resolved.confidence < approveAt
  ) {
    return { translationId, auditInput: null };
  }

  return {
    translationId,
    auditInput: {
      termId: cluster.termId,
      clusterId: cluster.clusterId,
      translationId,
      sourceText: cluster.canonicalText,
      translatedText: resolved.candidateText,
      domainCode: cluster.domainCode,
    },
  };
}

async function persistTranslateCandidatesAndTranslations(params: {
  client: TranslateCandidatesDbClient;
  payload: LexShardJobPayload;
  bundle: TranslateCandidatesBundle;
  resolvedByCluster: ReadonlyMap<string, ResolvedTranslationEntry>;
  aiClusterIdSet: ReadonlySet<string>;
}): Promise<{
  candidatesWritten: number;
  translationsWritten: number;
  translationIdsTouched: string[];
  auditInputs: LexTranslationAuditInput[];
}> {
  const { client, payload, bundle, resolvedByCluster, aiClusterIdSet } = params;
  const approveAt = bundle.translationAutoApproveThreshold;
  const translationIdsTouched: string[] = [];
  const auditInputs: LexTranslationAuditInput[] = [];
  let candidatesWritten = 0;
  let translationsWritten = 0;

  for (const cluster of bundle.clusters) {
    if (!cluster.canonicalText?.trim()) {
      continue;
    }
    const resolved = resolvedByCluster.get(cluster.clusterId);
    if (!resolved) {
      continue;
    }

    const { translationId, auditInput } = await upsertLexClusterCandidateAndTranslation({
      client,
      payload,
      bundle,
      cluster,
      resolved,
      approveAt,
      aiClusterIdSet,
    });
    candidatesWritten += 1;
    if (translationId) {
      translationIdsTouched.push(translationId);
      translationsWritten += 1;
    }
    if (auditInput) {
      auditInputs.push(auditInput);
    }
  }

  return { candidatesWritten, translationsWritten, translationIdsTouched, auditInputs };
}

async function updateLexRunTranslationsCount(
  client: TranslateCandidatesDbClient,
  runId: string,
  shopId: string
): Promise<void> {
  await client.query(
    `UPDATE lex_runs
     SET translations_count = (
           SELECT COUNT(*)
           FROM lex_translations
           WHERE shop_id = $2
             AND created_at >= COALESCE((
               SELECT started_at FROM lex_runs WHERE id = $1 AND shop_id = $2
             ), '-infinity'::timestamptz)
         ),
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [runId, shopId]
  );
}

async function runTranslateCandidatesDbPhase(
  client: TranslateCandidatesDbClient,
  ctx: {
    payload: LexShardJobPayload;
    bundle: TranslateCandidatesBundle;
    tmVectorsByIndex: Map<number, readonly number[]> | null;
    tmStats: { hits: number; misses: number; similaritySum: number };
    env: ReturnType<typeof loadEnv>;
    logger: Logger;
  }
): Promise<TranslateCandidatesDbPhaseResult> {
  const { payload, bundle, tmVectorsByIndex, tmStats, env, logger } = ctx;

  if (bundle.clusters.length === 0) {
    return emptyTranslateCandidatesDbPhaseResult();
  }

  const { resolvedByCluster, aiClusters } = await resolveTranslationsForClustersLoop({
    client,
    payload,
    bundle,
    tmVectorsByIndex,
    tmStats,
    logger,
  });

  await mergeLexAiTranslationBatchOutputs({
    resolvedByCluster,
    aiClusters,
    payload,
    env,
    logger,
  });

  const guardrailReviewItemsCreated = await stripGuardrailBlockedClusters({
    client,
    payload,
    bundle,
    resolvedByCluster,
  });

  const confidenceDistribution = summarizeConfidenceDistribution(
    collectTranslateConfidenceSamples(bundle, resolvedByCluster)
  );

  const aiClusterIdSet = new Set(aiClusters.map((c) => c.clusterId));

  const { candidatesWritten, translationsWritten, translationIdsTouched, auditInputs } =
    await persistTranslateCandidatesAndTranslations({
      client,
      payload,
      bundle,
      resolvedByCluster,
      aiClusterIdSet,
    });

  await updateLexRunTranslationsCount(client, payload.runId, payload.shopId);

  return {
    clustersProcessed: bundle.clusters.length,
    candidatesWritten,
    translationsWritten,
    translationIdsTouched,
    tmHits: tmStats.hits,
    tmMisses: tmStats.misses,
    tmSimilaritySum: tmStats.similaritySum,
    auditInputs,
    confidenceDistribution,
    guardrailReviewItemsCreated,
  };
}

async function finalizeTranslateCandidatesShardSuccess(params: {
  phaseResult: TranslateCandidatesDbPhaseResult;
  bundle: TranslateCandidatesBundle;
  payload: LexShardJobPayload;
  env: ReturnType<typeof loadEnv>;
  logger: Logger;
}): Promise<void> {
  const { phaseResult, bundle, payload, env, logger } = params;
  const { confidenceDistribution, ...shardCompletedPayload } = phaseResult;

  let qualityAudit: {
    auditBatchIds: string[];
    reviewItemsCreated: number;
    suggestionCandidatesWritten: number;
  } | null = null;
  if (
    phaseResult.auditInputs.length >= bundle.qualityAuditMinBatchSize &&
    bundle.qualityAuditEnabled
  ) {
    try {
      qualityAudit = await processLexTranslationQualityAudit({
        shopId: payload.shopId,
        runId: payload.runId,
        env,
        logger,
        sourceLang: bundle.langs.sourceLang,
        targetLang: bundle.langs.targetLang,
        items: [...phaseResult.auditInputs],
      });
    } catch (err) {
      logger.warn(
        {
          shopId: payload.shopId,
          runId: payload.runId,
          err: err instanceof Error ? err.message : String(err),
        },
        'lex_translation_quality_audit_failed'
      );
    }
  }

  if (phaseResult.translationIdsTouched.length > 0) {
    await syncLexTranslationSourceEmbeddings({
      shopId: payload.shopId,
      translationIds: [...phaseResult.translationIdsTouched],
      env,
      logger,
    }).catch(() => undefined);
  }

  await saveLexCheckpoint({
    shopId: payload.shopId,
    runId: payload.runId,
    shardId: payload.shardId,
    workerName: 'lex-translate-candidates-worker',
    checkpointType: 'phase_marker',
    checkpointValue: {
      phase: 'translate.candidates',
      status: 'completed',
      clustersProcessed: phaseResult.clustersProcessed,
      candidatesWritten: phaseResult.candidatesWritten,
      translationsWritten: phaseResult.translationsWritten,
      tmHits: phaseResult.tmHits,
      tmMisses: phaseResult.tmMisses,
      tmSimilaritySum: phaseResult.tmSimilaritySum,
    },
  });

  await markLexShardCompleted({
    shopId: payload.shopId,
    shardId: payload.shardId,
    recordsRead: phaseResult.clustersProcessed,
    recordsWritten: phaseResult.candidatesWritten + phaseResult.translationsWritten,
    metadataPatch: {
      translationIdsTouched: [...phaseResult.translationIdsTouched],
    },
  }).catch(() => undefined);

  await recordLexPhaseEvent({
    shopId: payload.shopId,
    runId: payload.runId,
    shardId: payload.shardId,
    phaseName: 'translate.candidates',
    eventType: 'translate_candidates_confidence',
    details: {
      ...confidenceDistribution,
      translationAutoApproveThreshold: bundle.translationAutoApproveThreshold,
    },
  });

  await recordLexPhaseEvent({
    shopId: payload.shopId,
    runId: payload.runId,
    shardId: payload.shardId,
    phaseName: 'translate.candidates',
    eventType: 'shard_completed',
    details: {
      ...shardCompletedPayload,
      qualityAudit,
    },
  });

  await advanceLexRunPhaseIfComplete({
    shopId: payload.shopId,
    runId: payload.runId,
    phaseName: 'translate.candidates',
    logger,
  });
}

async function processLexTranslateCandidatesJob(
  job: LexShardProcessJob,
  logger: Logger
): Promise<TranslateCandidatesDbPhaseResult | TranslateCandidatesSkippedPhaseResult> {
  if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
    throw new Error(`unknown_lex_translate_candidates_job:${job.name}`);
  }

  const payload = job.data as LexShardJobPayload;
  if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'translate.candidates') {
    throw new Error('invalid_lex_translate_candidates_shard_payload');
  }

  const env = loadEnv();

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
      tmHits: 0,
      tmMisses: 0,
      tmSimilaritySum: 0,
    };
  }

  await markLexShardActive({
    shopId: payload.shopId,
    shardId: payload.shardId,
    workerName: 'lex-translate-candidates-worker',
  });

  try {
    const bundle = await loadTranslateCandidatesWorkerBundle(payload, shard, logger);
    const tmStats = { hits: 0, misses: 0, similaritySum: 0 };
    const tmVectorsByIndex = await buildTmEmbeddingMapForTranslateCandidates(
      payload,
      bundle,
      env,
      logger
    );

    const phaseResult = await withTenantContext(payload.shopId, (client) =>
      runTranslateCandidatesDbPhase(client, {
        payload,
        bundle,
        tmVectorsByIndex,
        tmStats,
        env,
        logger,
      })
    );

    await finalizeTranslateCandidatesShardSuccess({
      phaseResult,
      bundle,
      payload,
      env,
      logger,
    });

    return phaseResult;
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
}

export function startLexTranslateCandidatesWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
    workerId: 'lex-translate-candidates-worker',
    processor: async (job) => processLexTranslateCandidatesJob(job, logger),
  });
}
