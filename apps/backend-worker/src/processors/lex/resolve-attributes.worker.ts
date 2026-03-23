import type { Logger } from '@app/logger';
import type { LexResolveAttributesJobPayload, LexShardJobPayload } from '@app/types';
import { validateLexResolveAttributesJobPayload, validateLexShardJobPayload } from '@app/types';
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
import {
  decimalString,
  loadLexShopLangPair,
  parseTouchedIds,
  type TenantClient,
} from './pipeline-utils.js';
import {
  buildPreparedLexAttributeResolutionRow,
  type LexAttributePreparedResolutionRow,
  type LexAttributeResolutionInputRow,
} from './resolve-attribute-resolution-prepared.js';

type ResolutionInputRow = LexAttributeResolutionInputRow;
type PreparedResolutionRow = LexAttributePreparedResolutionRow;

/** 7 bind params per row; keep chunks under driver limits. */
const RESOLVE_ATTR_CANDIDATE_BATCH = 400;
const RESOLVE_ATTR_RESOLUTION_BATCH = 500;
const RESOLVE_ATTR_PUBLICATION_BATCH = 500;

type PreparedWithDefinition = PreparedResolutionRow & {
  definitionId: string;
  publication: NonNullable<PreparedResolutionRow['publication']>;
};

function isPreparedWithDefinition(pr: PreparedResolutionRow): pr is PreparedWithDefinition {
  return pr.definitionId !== null && pr.publication !== null;
}

async function loadProdAttrDefinitionIdsByLowerLabel(
  client: TenantClient,
  uniqueLowerLabels: readonly string[]
): Promise<Map<string, string>> {
  const defLookup = new Map<string, string>();
  for (let off = 0; off < uniqueLowerLabels.length; off += 500) {
    const chunk = uniqueLowerLabels.slice(off, off + 500);
    const placeholders = chunk.map((_, i) => `$${i + 1}`).join(', ');
    const defRes = await client.query<{ id: string; label: string }>(
      `SELECT DISTINCT ON (LOWER(label)) id, label
       FROM prod_attr_definitions
       WHERE LOWER(label) IN (${placeholders})
       ORDER BY LOWER(label), display_order ASC NULLS LAST, label ASC`,
      chunk
    );
    for (const d of defRes.rows) {
      defLookup.set(d.label.toLowerCase(), d.id);
    }
  }
  return defLookup;
}

async function loadProdAttrSynonymDefinitionIdsByLowerText(
  client: TenantClient,
  uniqueLowerLabels: readonly string[],
  defLookup: ReadonlyMap<string, string>
): Promise<Map<string, string>> {
  const textsNeedingSynonymLookup = uniqueLowerLabels.filter((t) => !defLookup.has(t));
  const synLookup = new Map<string, string>();
  for (let off = 0; off < textsNeedingSynonymLookup.length; off += 500) {
    const chunk = textsNeedingSynonymLookup.slice(off, off + 500);
    const placeholders = chunk.map((_, i) => `$${i + 1}`).join(', ');
    const synRes = await client.query<{ synonymText: string; definitionId: string }>(
      `SELECT DISTINCT ON (LOWER(synonym_text))
              LOWER(synonym_text) AS "synonymText",
              definition_id AS "definitionId"
       FROM prod_attr_synonyms
       WHERE LOWER(synonym_text) IN (${placeholders})
         AND is_approved = true
       ORDER BY LOWER(synonym_text), confidence_score DESC NULLS LAST, created_at DESC`,
      chunk
    );
    for (const s of synRes.rows) {
      synLookup.set(s.synonymText, s.definitionId);
    }
  }
  return synLookup;
}

async function prepareLexAttributeResolutionRows(params: {
  client: TenantClient;
  targetLang: string;
  inputRows: readonly ResolutionInputRow[];
}): Promise<PreparedResolutionRow[]> {
  if (params.inputRows.length === 0) return [];

  const uniqueTexts = [...new Set(params.inputRows.map((r) => r.canonicalText.toLowerCase()))];
  const defLookup = await loadProdAttrDefinitionIdsByLowerLabel(params.client, uniqueTexts);
  const synLookup = await loadProdAttrSynonymDefinitionIdsByLowerText(
    params.client,
    uniqueTexts,
    defLookup
  );

  return params.inputRows.map((row) =>
    buildPreparedLexAttributeResolutionRow(row, params.targetLang, defLookup, synLookup)
  );
}

async function batchUpsertLexAttributeResolutionCandidates(params: {
  client: TenantClient;
  shopId: string;
  prepared: readonly PreparedResolutionRow[];
}): Promise<Map<string, string>> {
  const candidateIdByTermId = new Map<string, string>();
  for (let offset = 0; offset < params.prepared.length; offset += RESOLVE_ATTR_CANDIDATE_BATCH) {
    const chunk = params.prepared.slice(offset, offset + RESOLVE_ATTR_CANDIDATE_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const pr of chunk) {
      placeholders.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, 'attribute_label', $${p++}, $${p++}::jsonb, $${p++}, now(), now())`
      );
      values.push(
        params.shopId,
        pr.termId,
        pr.clusterId,
        pr.definitionId,
        decimalString(pr.confidence),
        pr.evidenceJson,
        pr.status
      );
    }

    const candidateRes = await params.client.query<{ id: string; term_id: string }>(
      `INSERT INTO lex_attribute_resolution_candidates
         (shop_id, term_id, cluster_id, definition_id, resolution_role, confidence_score, evidence, status, created_at, updated_at)
       VALUES
         ${placeholders.join(', ')}
       ON CONFLICT (
         shop_id,
         term_id,
         (COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         (COALESCE(definition_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         resolution_role
       )
       DO UPDATE SET
         confidence_score = EXCLUDED.confidence_score,
         evidence = EXCLUDED.evidence,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id, term_id`,
      values
    );

    for (const r of candidateRes.rows) {
      candidateIdByTermId.set(r.term_id, r.id);
    }
  }
  return candidateIdByTermId;
}

async function batchUpsertLexAttributeResolutions(params: {
  client: TenantClient;
  shopId: string;
  rows: readonly PreparedWithDefinition[];
  candidateIdByTermId: ReadonlyMap<string, string>;
}): Promise<number> {
  let resolutionsWritten = 0;
  for (let offset = 0; offset < params.rows.length; offset += RESOLVE_ATTR_RESOLUTION_BATCH) {
    const chunk = params.rows.slice(offset, offset + RESOLVE_ATTR_RESOLUTION_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const pr of chunk) {
      placeholders.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, 'attribute_label', $${p++}, $${p++}, 'approved', now(), '{}'::jsonb, now(), now())`
      );
      values.push(
        params.shopId,
        pr.termId,
        pr.clusterId,
        pr.definitionId,
        params.candidateIdByTermId.get(pr.termId) ?? null,
        decimalString(pr.confidence)
      );
    }

    await params.client.query(
      `INSERT INTO lex_attribute_resolutions
         (shop_id, term_id, cluster_id, definition_id, resolution_role, source_candidate_id,
          confidence_score, status, approved_at, metadata, created_at, updated_at)
       VALUES
         ${placeholders.join(', ')}
       ON CONFLICT (shop_id, term_id, cluster_id, definition_id, resolution_role)
       DO UPDATE
          SET source_candidate_id = EXCLUDED.source_candidate_id,
              confidence_score = EXCLUDED.confidence_score,
              status = 'approved',
              approved_at = now(),
              updated_at = now()`,
      values
    );
    resolutionsWritten += chunk.length;
  }
  return resolutionsWritten;
}

async function batchInsertLexPublicationTargetsForResolve(params: {
  client: TenantClient;
  shopId: string;
  rows: readonly PreparedWithDefinition[];
}): Promise<void> {
  for (let offset = 0; offset < params.rows.length; offset += RESOLVE_ATTR_PUBLICATION_BATCH) {
    const chunk = params.rows.slice(offset, offset + RESOLVE_ATTR_PUBLICATION_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const pr of chunk) {
      const pub = pr.publication;
      placeholders.push(
        `(NULL, NULL, $${p++}, 'prod_attr_synonyms', $${p++}, $${p++}, $${p++}, $${p++}, 'pending', $${p++}::jsonb, now(), now())`
      );
      values.push(
        params.shopId,
        pr.definitionId,
        pub.targetPath,
        pub.idempotencyKey,
        pub.targetSnapshotHash,
        pub.payloadJson
      );
    }

    await params.client.query(
      `INSERT INTO lex_publication_targets
         (translation_id, localization_id, shop_id, target_type, target_record_id, target_path, idempotency_key,
          target_snapshot_hash, status, payload, created_at, updated_at)
       VALUES
         ${placeholders.join(', ')}
       ON CONFLICT (
         (COALESCE(localization_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         target_type,
         (COALESCE(target_record_id::text, target_path, '')),
         (COALESCE(target_snapshot_hash, ''))
       )
       DO NOTHING`,
      values
    );
  }
}

async function runLexResolveAttributesTenantWrites(params: {
  client: TenantClient;
  shopId: string;
  termIds: string[];
  logger?: Logger;
}): Promise<{ candidatesWritten: number; resolutionsWritten: number; termIdsTouched: string[] }> {
  const { targetLang } = await loadLexShopLangPair({
    client: params.client,
    shopId: params.shopId,
  });
  if (params.termIds.length === 0) {
    return { candidatesWritten: 0, resolutionsWritten: 0, termIdsTouched: [] };
  }

  const inputs = await params.client.query<ResolutionInputRow>(
    `SELECT DISTINCT ON (t.id)
       t.id AS "termId",
       c.id AS "clusterId",
       t.canonical_text AS "canonicalText",
       t.normalized_key AS "normalizedKey"
     FROM lex_terms t
     LEFT JOIN lex_sense_clusters c
            ON c.term_id = t.id
           AND (c.shop_id = $1 OR c.shop_id IS NULL)
     WHERE t.id = ANY($2::uuid[])
       AND (t.shop_id = $1 OR t.shop_id IS NULL)
     ORDER BY
       t.id,
       c.confidence_score DESC NULLS LAST,
       c.created_at DESC NULLS LAST,
       c.id ASC NULLS LAST`,
    [params.shopId, params.termIds]
  );

  const prepared = await prepareLexAttributeResolutionRows({
    client: params.client,
    targetLang,
    inputRows: inputs.rows,
  });

  for (const pr of prepared) {
    if (pr.definitionId && pr.definitionId === pr.termId) {
      params.logger?.warn(
        { shopId: params.shopId, termId: pr.termId, definitionId: pr.definitionId },
        'lex_resolve_attr_circular_reference_detected'
      );
    }
  }

  const definitionIds = [
    ...new Set(prepared.filter((p) => p.definitionId).map((p) => p.definitionId!)),
  ];
  if (definitionIds.length > 0) {
    const validDefs = await params.client.query<{ id: string }>(
      `SELECT id FROM prod_attr_definitions WHERE id = ANY($1::uuid[])`,
      [definitionIds]
    );
    const validDefIds = new Set(validDefs.rows.map((r) => r.id));
    for (const pr of prepared) {
      if (pr.definitionId && !validDefIds.has(pr.definitionId)) {
        params.logger?.warn(
          { shopId: params.shopId, termId: pr.termId, definitionId: pr.definitionId },
          'lex_resolve_attr_definition_out_of_scope'
        );
      }
    }
  }

  const candidatesWritten = prepared.length;
  let resolutionsWritten = 0;

  if (prepared.length > 0) {
    const candidateIdByTermId = await batchUpsertLexAttributeResolutionCandidates({
      client: params.client,
      shopId: params.shopId,
      prepared,
    });

    const withDefinition = prepared.filter(isPreparedWithDefinition);

    if (withDefinition.length > 0) {
      resolutionsWritten = await batchUpsertLexAttributeResolutions({
        client: params.client,
        shopId: params.shopId,
        rows: withDefinition,
        candidateIdByTermId,
      });
      await batchInsertLexPublicationTargetsForResolve({
        client: params.client,
        shopId: params.shopId,
        rows: withDefinition,
      });
    }
  }

  return {
    candidatesWritten,
    resolutionsWritten,
    termIdsTouched: [...new Set(inputs.rows.map((row) => row.termId))],
  };
}

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
    // One row per term: multiple clusters per term would duplicate candidates/resolutions (f1-51).
    return runLexResolveAttributesTenantWrites({
      client,
      shopId: params.payload.shopId,
      termIds,
      logger: params.logger,
    });
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
  }).catch(() => undefined);

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
        if (!validateLexResolveAttributesJobPayload(payload)) {
          throw new Error('invalid_lex_resolve_attributes_payload');
        }
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
            try {
              await enqueueLexShardJob(LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME, {
                shopId: payload.shopId,
                runId: payload.runId,
                shardId: shard.id,
                queuePhase: 'resolve.attributes',
                requestedAt: Date.now(),
              });
            } catch (error) {
              logger.error(
                {
                  err: error,
                  shopId: payload.shopId,
                  runId: payload.runId,
                  shardId: shard.id,
                },
                'lex_resolve_attributes_enqueue_shard_failed'
              );
              let enqueueErrorMsg = 'enqueue_lex_shard_failed';
              if (error instanceof Error) {
                enqueueErrorMsg = error.message;
              } else if (typeof error === 'string') {
                enqueueErrorMsg = error;
              }
              await markLexShardFailed({
                shopId: payload.shopId,
                shardId: shard.id,
                errorMessage: enqueueErrorMsg,
              }).catch(() => undefined);
            }
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
