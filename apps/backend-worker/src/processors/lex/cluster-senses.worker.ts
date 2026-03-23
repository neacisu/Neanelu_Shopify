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
import { decimalString, parseTouchedIds } from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';
import {
  buildPreparedClusterSenseGroups,
  type LexClusterSenseContextRow as ContextRow,
  type LexClusterSenseTermLabelRow as TermLabelRow,
  type LexPreparedClusterSenseGroup as PreparedClusterGroup,
} from './cluster-senses-pure.js';

const CLUSTER_UPSERT_BATCH = 80;
const MEMBER_INSERT_BATCH = 400;

type ClusterMemberInsert = Readonly<{
  clusterId: string;
  contextId: string;
  similarity: string;
  isRepresentative: boolean;
}>;

function clusterCompositeKey(termId: string, clusterKey: string): string {
  return `${termId}\x1f${clusterKey}`;
}

async function batchUpsertSenseClusters(
  client: TenantClient,
  shopId: string,
  groups: readonly PreparedClusterGroup[]
): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  if (groups.length === 0) {
    return idByKey;
  }

  for (let offset = 0; offset < groups.length; offset += CLUSTER_UPSERT_BATCH) {
    const chunk = groups.slice(offset, offset + CLUSTER_UPSERT_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const g of chunk) {
      const rep = g.representative;
      placeholders.push(
        `($${p++}::uuid, $${p++}::uuid, $${p++}::text, 'heuristic', $${p++}, $${p++}::uuid, $${p++}, $${p++}, $${p++}::uuid, $${p++}, $${p++}, $${p++}, now(), now())`
      );
      values.push(
        shopId,
        g.termId,
        g.clusterKey,
        rep.domainCode,
        rep.taxonomyId,
        g.labelRo,
        rep.representativeText,
        rep.id,
        decimalString(g.confidence),
        g.needsReview,
        g.isApproved
      );
    }

    const res = await client.query<{ id: string; term_id: string; cluster_key: string }>(
      `INSERT INTO lex_sense_clusters
         (shop_id, term_id, cluster_key, cluster_method, domain_code, taxonomy_id, label_ro,
          description, representative_context_id, confidence_score, needs_review, is_approved, created_at, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (shop_id, term_id, cluster_key)
       DO UPDATE
          SET domain_code = EXCLUDED.domain_code,
              taxonomy_id = EXCLUDED.taxonomy_id,
              label_ro = EXCLUDED.label_ro,
              description = EXCLUDED.description,
              representative_context_id = EXCLUDED.representative_context_id,
              confidence_score = EXCLUDED.confidence_score,
              needs_review = EXCLUDED.needs_review,
              is_approved = CASE
                WHEN lex_sense_clusters.is_approved IS TRUE THEN TRUE
                ELSE EXCLUDED.is_approved
              END,
              updated_at = now()
       RETURNING id, term_id, cluster_key`,
      values
    );

    for (const row of res.rows) {
      idByKey.set(clusterCompositeKey(row.term_id, row.cluster_key), row.id);
    }
  }

  return idByKey;
}

async function batchDeleteClusterMembersForClusters(
  client: TenantClient,
  shopId: string,
  clusterIds: readonly string[]
): Promise<void> {
  if (clusterIds.length === 0) {
    return;
  }
  await client.query(
    `DELETE FROM lex_sense_cluster_members AS m
     USING lex_sense_clusters AS c
     WHERE m.cluster_id = c.id
       AND m.cluster_id = ANY($1::uuid[])
       AND (c.shop_id = $2::uuid OR c.shop_id IS NULL)`,
    [clusterIds, shopId]
  );
}

async function batchInsertClusterMembers(
  client: TenantClient,
  shopId: string,
  members: readonly ClusterMemberInsert[]
): Promise<void> {
  if (members.length === 0) {
    return;
  }

  for (let offset = 0; offset < members.length; offset += MEMBER_INSERT_BATCH) {
    const chunk = members.slice(offset, offset + MEMBER_INSERT_BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const m of chunk) {
      placeholders.push(`($${p++}::uuid, $${p++}::uuid, $${p++}, $${p++})`);
      values.push(m.clusterId, m.contextId, m.similarity, m.isRepresentative);
    }
    values.push(shopId);
    const shopParam = p;
    await client.query(
      `INSERT INTO lex_sense_cluster_members
         (cluster_id, context_id, similarity_score, is_representative, created_at)
       SELECT v.cluster_id,
              v.context_id,
              v.similarity_score::numeric,
              v.is_representative,
              now()
       FROM (VALUES ${placeholders.join(', ')})
            AS v(cluster_id, context_id, similarity_score, is_representative)
       INNER JOIN lex_sense_clusters c
               ON c.id = v.cluster_id
              AND (c.shop_id = $${shopParam}::uuid OR c.shop_id IS NULL)
       ON CONFLICT (cluster_id, context_id)
       DO UPDATE
          SET similarity_score = EXCLUDED.similarity_score,
              is_representative = EXCLUDED.is_representative`,
      values
    );
  }
}

async function loadClusterSensesInputData(
  client: TenantClient,
  shopId: string,
  termIds: readonly string[]
): Promise<{
  termMap: Map<string, TermLabelRow>;
  termsRows: readonly TermLabelRow[];
  contextsByTerm: Map<string, ContextRow[]>;
  allContexts: readonly ContextRow[];
}> {
  const terms = await client.query<TermLabelRow>(
    `SELECT id, display_text_ro AS "displayTextRo", canonical_text AS "canonicalText"
     FROM lex_terms
     WHERE id = ANY($1::uuid[])
       AND (shop_id = $2 OR shop_id IS NULL)`,
    [termIds, shopId]
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
    [shopId, termIds]
  );

  const contextsByTerm = new Map<string, ContextRow[]>();
  for (const context of contexts.rows) {
    const bucket = contextsByTerm.get(context.termId) ?? [];
    bucket.push(context);
    contextsByTerm.set(context.termId, bucket);
  }

  return {
    termMap,
    termsRows: terms.rows,
    contextsByTerm,
    allContexts: contexts.rows,
  };
}

function logClusterSensesDataQualityWarnings(params: {
  logger: Logger;
  shopId: string;
  preparedGroups: readonly PreparedClusterGroup[];
  allContexts: readonly ContextRow[];
  validTermIds: ReadonlySet<string>;
}): void {
  const { logger, shopId, preparedGroups, allContexts, validTermIds } = params;

  for (const group of preparedGroups) {
    if (group.members.length > 50) {
      logger.warn(
        {
          shopId,
          termId: group.termId,
          clusterKey: group.clusterKey,
          memberCount: group.members.length,
        },
        'lex_cluster_senses_oversized_cluster'
      );
    }
  }

  for (const ctx of allContexts) {
    if (!validTermIds.has(ctx.termId)) {
      logger.warn(
        { shopId, contextId: ctx.id, termId: ctx.termId },
        'lex_cluster_senses_cross_tenant_context_detected'
      );
    }
  }
}

async function persistClustersMembersAndRunStats(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  preparedGroups: readonly PreparedClusterGroup[];
}): Promise<{ clustersWritten: number; clusterIdsTouched: string[] }> {
  const { client, shopId, runId, preparedGroups } = params;

  const clusterIdByKey = await batchUpsertSenseClusters(client, shopId, preparedGroups);

  const clusterIdsTouched: string[] = [];
  const memberRows: ClusterMemberInsert[] = [];
  for (const g of preparedGroups) {
    const clusterId = clusterIdByKey.get(clusterCompositeKey(g.termId, g.clusterKey));
    if (!clusterId) {
      throw new Error('lex_cluster_senses_missing_cluster_id_after_upsert');
    }
    clusterIdsTouched.push(clusterId);
    const rep = g.representative;
    for (const member of g.members) {
      memberRows.push({
        clusterId,
        contextId: member.id,
        similarity: decimalString(member.id === rep.id ? 1 : 0.84),
        isRepresentative: member.id === rep.id,
      });
    }
  }

  await batchDeleteClusterMembersForClusters(client, shopId, clusterIdsTouched);
  await batchInsertClusterMembers(client, shopId, memberRows);

  await client.query(
    `UPDATE lex_runs
     SET sense_clusters_count = (
           SELECT COUNT(*)::bigint
           FROM lex_sense_clusters sc
           WHERE (sc.shop_id = $2 OR sc.shop_id IS NULL)
             AND EXISTS (
               SELECT 1
               FROM lex_term_occurrences o
               INNER JOIN lex_fragments f ON f.id = o.fragment_id
               WHERE o.term_id = sc.term_id
                 AND o.shop_id = $2
                 AND f.run_id = $1
                 AND f.shop_id = $2
             )
         ),
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [runId, shopId]
  );

  return {
    clustersWritten: clusterIdsTouched.length,
    clusterIdsTouched,
  };
}

async function runClusterSensesTenantWrites(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  termIds: string[];
  logger: Logger;
}): Promise<{ termIdsProcessed: number; clustersWritten: number; clusterIdsTouched: string[] }> {
  if (params.termIds.length === 0) {
    return { termIdsProcessed: 0, clustersWritten: 0, clusterIdsTouched: [] };
  }

  const { termMap, termsRows, contextsByTerm, allContexts } = await loadClusterSensesInputData(
    params.client,
    params.shopId,
    params.termIds
  );

  const preparedGroups = buildPreparedClusterSenseGroups(params.termIds, contextsByTerm, termMap);

  logClusterSensesDataQualityWarnings({
    logger: params.logger,
    shopId: params.shopId,
    preparedGroups,
    allContexts,
    validTermIds: new Set(termsRows.map((t) => t.id)),
  });

  const { clustersWritten, clusterIdsTouched } = await persistClustersMembersAndRunStats({
    client: params.client,
    shopId: params.shopId,
    runId: params.runId,
    preparedGroups,
  });

  return {
    termIdsProcessed: params.termIds.length,
    clustersWritten,
    clusterIdsTouched,
  };
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
          return runClusterSensesTenantWrites({
            client,
            shopId: payload.shopId,
            runId: payload.runId,
            termIds,
            logger,
          });
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
        }).catch(() => undefined);

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
