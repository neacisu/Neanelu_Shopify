import type { Logger } from '@app/logger';
import type { LexRetentionJobPayload } from '@app/types';
import { validateLexRetentionJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_RETENTION_COMPACT_QUEUE_NAME,
  LEX_RETENTION_JOB_NAME,
} from '../../queue/lex-queues.js';
import { repairLexPublicationSnapshots } from '../../services/lex-localizations.js';
import type { TenantClient } from './pipeline-types.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';

const DEFAULT_FRAGMENT_RETENTION_DAYS = 90;
const DEFAULT_OCCURRENCE_RETENTION_DAYS = 90;
const DEFAULT_CONTEXT_RETENTION_DAYS = 180;
const DEFAULT_PUBLISH_EVENT_RETENTION_DAYS = 365;
const DEFAULT_CHECKPOINT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 5;

/** Minimum 1 zi; valori din DB sau payload pot fi lipsă sau invalide. */
function effectiveRetentionDays(value: number | null | undefined, fallback: number): number {
  const raw = value ?? fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return Math.max(1, fallback);
  }
  return Math.max(1, Math.floor(raw));
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const RETENTION_BATCH_SIZE = positiveIntegerFromEnv(
  process.env['LEX_RETENTION_BATCH_SIZE'],
  DEFAULT_BATCH_SIZE
);
const RETENTION_MAX_BATCHES = positiveIntegerFromEnv(
  process.env['LEX_RETENTION_MAX_BATCHES'],
  DEFAULT_MAX_BATCHES
);

async function deleteIdsBatch(
  client: TenantClient,
  sqlText: string,
  values: readonly unknown[]
): Promise<number> {
  const result = await client.query<{ id: string }>(sqlText, values);
  return result.rows.length;
}

async function runRetentionBatches(
  executeBatch: () => Promise<number>,
  maxBatches: number
): Promise<number> {
  let totalDeleted = 0;
  for (let index = 0; index < maxBatches; index += 1) {
    const deleted = await executeBatch();
    totalDeleted += deleted;
    if (deleted < RETENTION_BATCH_SIZE) {
      break;
    }
  }
  return totalDeleted;
}

async function cleanupCheckpoints(client: TenantClient, shopId: string): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH doomed AS (
           SELECT cp.id
           FROM lex_checkpoints cp
           LEFT JOIN lex_runs r ON r.id = cp.run_id
           WHERE cp.shop_id = $1
             AND cp.updated_at < now() - ($2::text || ' days')::interval
             AND (
               r.id IS NULL
               OR r.status IN ('completed', 'failed', 'cancelled')
             )
           ORDER BY cp.updated_at ASC
           LIMIT $3
         )
         DELETE FROM lex_checkpoints cp
         USING doomed
         WHERE cp.id = doomed.id
         RETURNING cp.id`,
        [shopId, DEFAULT_CHECKPOINT_RETENTION_DAYS, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function cleanupPublishEvents(client: TenantClient, shopId: string): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH doomed AS (
           SELECT pe.id
           FROM lex_publish_events pe
           WHERE pe.shop_id = $1
             AND pe.created_at < now() - ($2::text || ' days')::interval
           ORDER BY pe.created_at ASC
           LIMIT $3
         )
         DELETE FROM lex_publish_events pe
         USING doomed
         WHERE pe.id = doomed.id
         RETURNING pe.id`,
        [shopId, DEFAULT_PUBLISH_EVENT_RETENTION_DAYS, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function cleanupContextEmbeddings(
  client: TenantClient,
  shopId: string,
  retentionDaysContexts: number
): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH protected_contexts AS (
           SELECT DISTINCT scm.context_id
           FROM lex_sense_cluster_members scm
           INNER JOIN lex_sense_clusters sc
             ON sc.id = scm.cluster_id
           WHERE sc.shop_id = $1
             AND sc.is_approved = true
           UNION
           SELECT sc.representative_context_id
           FROM lex_sense_clusters sc
           WHERE sc.shop_id = $1
             AND sc.is_approved = true
             AND sc.representative_context_id IS NOT NULL
         ),
         doomed AS (
           SELECT e.id
           FROM lex_context_embeddings e
           INNER JOIN lex_term_contexts ctx
             ON ctx.id = e.context_id
           WHERE e.shop_id = $1
             AND e.created_at < now() - ($2::text || ' days')::interval
             AND NOT EXISTS (
               SELECT 1
               FROM protected_contexts pc
               WHERE pc.context_id = e.context_id
             )
           ORDER BY e.created_at ASC
           LIMIT $3
         )
         DELETE FROM lex_context_embeddings e
         USING doomed
         WHERE e.id = doomed.id
         RETURNING e.id`,
        [shopId, retentionDaysContexts, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function cleanupTermContexts(
  client: TenantClient,
  shopId: string,
  retentionDaysContexts: number
): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH protected_contexts AS (
           SELECT DISTINCT scm.context_id
           FROM lex_sense_cluster_members scm
           INNER JOIN lex_sense_clusters sc
             ON sc.id = scm.cluster_id
           WHERE sc.shop_id = $1
             AND sc.is_approved = true
           UNION
           SELECT sc.representative_context_id
           FROM lex_sense_clusters sc
           WHERE sc.shop_id = $1
             AND sc.is_approved = true
             AND sc.representative_context_id IS NOT NULL
         ),
         doomed AS (
           SELECT ctx.id
           FROM lex_term_contexts ctx
           WHERE ctx.shop_id = $1
             AND ctx.updated_at < now() - ($2::text || ' days')::interval
             AND NOT EXISTS (
               SELECT 1
               FROM protected_contexts pc
               WHERE pc.context_id = ctx.id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM lex_term_occurrences occ
               INNER JOIN lex_runs r ON r.id = occ.run_id
               WHERE occ.shop_id = ctx.shop_id
                 AND occ.term_id = ctx.term_id
                 AND occ.context_hash = ctx.context_hash
                 AND r.status NOT IN ('completed', 'failed', 'cancelled')
             )
           ORDER BY ctx.updated_at ASC
           LIMIT $3
         )
         DELETE FROM lex_term_contexts ctx
         USING doomed
         WHERE ctx.id = doomed.id
         RETURNING ctx.id`,
        [shopId, retentionDaysContexts, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function cleanupTermOccurrences(
  client: TenantClient,
  shopId: string,
  retentionDaysOccurrences: number
): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH doomed AS (
           SELECT occ.id
           FROM lex_term_occurrences occ
           INNER JOIN lex_runs r
             ON r.id = occ.run_id
           WHERE occ.shop_id = $1
             AND occ.created_at < now() - ($2::text || ' days')::interval
             AND r.status IN ('completed', 'failed', 'cancelled')
           ORDER BY occ.created_at ASC
           LIMIT $3
         )
         DELETE FROM lex_term_occurrences occ
         USING doomed
         WHERE occ.id = doomed.id
         RETURNING occ.id`,
        [shopId, retentionDaysOccurrences, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function cleanupFragments(
  client: TenantClient,
  shopId: string,
  retentionDaysFragments: number
): Promise<number> {
  return await runRetentionBatches(
    async () =>
      await deleteIdsBatch(
        client,
        `WITH doomed AS (
           SELECT frag.id
           FROM lex_fragments frag
           INNER JOIN lex_runs r
             ON r.id = frag.run_id
           WHERE frag.shop_id = $1
             AND frag.created_at < now() - ($2::text || ' days')::interval
             AND r.status IN ('completed', 'failed', 'cancelled')
           ORDER BY frag.created_at ASC
           LIMIT $3
         )
         DELETE FROM lex_fragments frag
         USING doomed
         WHERE frag.id = doomed.id
         RETURNING frag.id`,
        [shopId, retentionDaysFragments, RETENTION_BATCH_SIZE]
      ),
    RETENTION_MAX_BATCHES
  );
}

async function runRetentionStep(
  logger: Logger,
  shopId: string,
  step: string,
  fn: () => Promise<number>
): Promise<number> {
  try {
    return await fn();
  } catch (error) {
    logger.error(
      {
        err: error,
        shopId,
        step,
      },
      'lex_retention_cleanup_step_failed'
    );
    return 0;
  }
}

async function compactLexRetention(params: {
  shopId: string;
  payload: LexRetentionJobPayload;
  logger: Logger;
}): Promise<{
  deleted: {
    checkpoints: number;
    publishEvents: number;
    embeddings: number;
    contexts: number;
    occurrences: number;
    fragments: number;
  };
  snapshotRepair: {
    scanned: number;
    repaired: number;
    blocked: number;
  };
}> {
  return await withTenantContext(params.shopId, async (client) => {
    const settingsRes = await client.query<{
      retentionDaysFragments: number | null;
      retentionDaysOccurrences: number | null;
      retentionDaysContexts: number | null;
    }>(
      `SELECT
         retention_days_fragments AS "retentionDaysFragments",
         retention_days_occurrences AS "retentionDaysOccurrences",
         retention_days_contexts AS "retentionDaysContexts"
       FROM lex_shop_settings
       WHERE shop_id = $1
       LIMIT 1`,
      [params.shopId]
    );

    const settings = settingsRes.rows[0];
    const payloadDays = params.payload.retentionDays;
    const retentionDaysFragments = effectiveRetentionDays(
      payloadDays ?? settings?.retentionDaysFragments,
      DEFAULT_FRAGMENT_RETENTION_DAYS
    );
    const retentionDaysOccurrences = effectiveRetentionDays(
      payloadDays ?? settings?.retentionDaysOccurrences,
      DEFAULT_OCCURRENCE_RETENTION_DAYS
    );
    const retentionDaysContexts = effectiveRetentionDays(
      payloadDays ?? settings?.retentionDaysContexts,
      DEFAULT_CONTEXT_RETENTION_DAYS
    );

    const checkpoints = await runRetentionStep(params.logger, params.shopId, 'checkpoints', () =>
      cleanupCheckpoints(client, params.shopId)
    );
    const publishEvents = await runRetentionStep(
      params.logger,
      params.shopId,
      'publish_events',
      () => cleanupPublishEvents(client, params.shopId)
    );
    const embeddings = await runRetentionStep(
      params.logger,
      params.shopId,
      'context_embeddings',
      () => cleanupContextEmbeddings(client, params.shopId, retentionDaysContexts)
    );
    const contexts = await runRetentionStep(params.logger, params.shopId, 'term_contexts', () =>
      cleanupTermContexts(client, params.shopId, retentionDaysContexts)
    );
    const occurrences = await runRetentionStep(
      params.logger,
      params.shopId,
      'term_occurrences',
      () => cleanupTermOccurrences(client, params.shopId, retentionDaysOccurrences)
    );
    const fragments = await runRetentionStep(params.logger, params.shopId, 'fragments', () =>
      cleanupFragments(client, params.shopId, retentionDaysFragments)
    );

    let snapshotRepair = { scanned: 0, repaired: 0, blocked: 0 };
    try {
      snapshotRepair = await repairLexPublicationSnapshots({
        shopId: params.shopId,
        limit: RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES,
      });
    } catch (error) {
      params.logger.error(
        { err: error, shopId: params.shopId, step: 'snapshot_repair' },
        'lex_retention_cleanup_step_failed'
      );
    }

    return {
      deleted: {
        checkpoints,
        publishEvents,
        embeddings,
        contexts,
        occurrences,
        fragments,
      },
      snapshotRepair,
    };
  });
}

export function startLexRetentionWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_RETENTION_COMPACT_QUEUE_NAME,
    workerId: 'lex-retention-compact-worker',
    processor: async (job) => {
      if (job.name !== LEX_RETENTION_JOB_NAME) {
        throw new Error(`unknown_lex_retention_job:${job.name}`);
      }

      const payload = job.data as LexRetentionJobPayload;
      if (!validateLexRetentionJobPayload(payload)) {
        throw new Error('invalid_lex_retention_payload');
      }

      const result = await compactLexRetention({
        shopId: payload.shopId,
        payload,
        logger,
      });

      return {
        ...result,
        totalDeleted: Object.values(result.deleted).reduce((sum, value) => sum + value, 0),
      };
    },
  });
}
