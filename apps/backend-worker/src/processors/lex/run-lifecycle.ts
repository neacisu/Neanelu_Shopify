import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';

import { enqueueLexShardJob } from '../../queue/lex-queues.js';
import { type LexPhaseName, nextLexPhase, LEX_PHASE_TO_QUEUE } from './phases.js';
import { withLexAdvisoryLock } from './advisory-locks.js';

interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
}

export async function recordLexPhaseEvent(params: {
  shopId: string;
  runId: string;
  shardId?: string | null;
  phaseName: string;
  eventType: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO lex_run_phase_events
         (run_id, shard_id, shop_id, phase_name, event_type, details, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [
        params.runId,
        params.shardId ?? null,
        params.shopId,
        params.phaseName,
        params.eventType,
        JSON.stringify(params.details ?? {}),
      ]
    );
  });
}

export async function markLexRunStarted(params: {
  shopId: string;
  runId: string;
  phaseName: LexPhaseName;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_runs
       SET status = 'running',
           current_phase = $3,
           started_at = COALESCE(started_at, now()),
           phase_started_at = COALESCE(phase_started_at, now()),
           resumed_at = CASE WHEN status = 'paused' THEN now() ELSE resumed_at END,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId, params.phaseName]
    );
  });
}

export async function markLexRunCompleted(params: {
  shopId: string;
  runId: string;
  completedWithErrors?: boolean;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_runs
       SET status = 'completed',
           completed_at = now(),
           phase_completed_at = now(),
           completed_with_errors = COALESCE($3, completed_with_errors),
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId, params.completedWithErrors === true]
    );
  });
}

export async function markLexRunFailed(params: {
  shopId: string;
  runId: string;
  errorMessage: string;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_runs
       SET status = 'failed',
           error_message = $3,
           phase_completed_at = now(),
           completed_at = now(),
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId, params.errorMessage]
    );
  });
}

export async function markLexRunPaused(params: {
  shopId: string;
  runId: string;
  pauseReason: string;
  errorMessage?: string | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_runs
       SET status = 'paused',
           paused_at = now(),
           pause_reason = $3,
           error_message = COALESCE($4, error_message),
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId, params.pauseReason, params.errorMessage ?? null]
    );
  });
}

export async function markLexShardActive(params: {
  shopId: string;
  shardId: string;
  workerName: string;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_run_shards
       SET status = 'running',
           worker_name = $3,
           started_at = COALESCE(started_at, now())
       WHERE id = $1
         AND shop_id = $2`,
      [params.shardId, params.shopId, params.workerName]
    );
  });
}

export async function markLexShardCompleted(params: {
  shopId: string;
  shardId: string;
  recordsRead?: number;
  recordsWritten?: number;
  metadataPatch?: Record<string, unknown>;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_run_shards
       SET status = 'completed',
           completed_at = now(),
           records_read = COALESCE($3, records_read),
           records_written = COALESCE($4, records_written),
           metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
       WHERE id = $1
         AND shop_id = $2`,
      [
        params.shardId,
        params.shopId,
        params.recordsRead ?? null,
        params.recordsWritten ?? null,
        JSON.stringify(params.metadataPatch ?? {}),
      ]
    );
  });
}

export async function markLexShardFailed(params: {
  shopId: string;
  shardId: string;
  errorMessage: string;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_run_shards
       SET status = 'failed',
           error_message = $3,
           completed_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.shardId, params.shopId, params.errorMessage]
    );
  });
}

export async function loadLexShard(params: {
  shopId: string;
  runId: string;
  shardId: string;
}): Promise<{
  id: string;
  runId: string;
  shopId: string;
  phaseName: LexPhaseName;
  sourceTable: string;
  status: string;
  metadata: Record<string, unknown>;
} | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      runId: string;
      shopId: string;
      phaseName: LexPhaseName;
      sourceTable: string;
      status: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT
         id,
         run_id AS "runId",
         shop_id AS "shopId",
         phase_name AS "phaseName",
         source_table AS "sourceTable",
         status,
         metadata
       FROM lex_run_shards
       WHERE id = $1
         AND run_id = $2
         AND shop_id = $3
       LIMIT 1`,
      [params.shardId, params.runId, params.shopId]
    );

    const row = result.rows[0];
    if (!row) return null;
    return { ...row, metadata: row.metadata ?? {} };
  });
}

async function cloneShardsForNextPhase(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  phaseName: LexPhaseName;
  nextPhase: LexPhaseName;
}): Promise<string[]> {
  const shards = await params.client.query<{
    id: string;
    sourceTable: string;
    shardKey: string;
    minSourceId: string | null;
    maxSourceId: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT
       id,
       source_table AS "sourceTable",
       shard_key AS "shardKey",
       min_source_id AS "minSourceId",
       max_source_id AS "maxSourceId",
       metadata
     FROM lex_run_shards
     WHERE run_id = $1
       AND shop_id = $2
       AND phase_name = $3
       AND status = 'completed'
     ORDER BY created_at ASC`,
    [params.runId, params.shopId, params.phaseName]
  );

  const createdShardIds: string[] = [];
  for (const shard of shards.rows) {
    const inserted = await params.client.query<{ id: string }>(
      `INSERT INTO lex_run_shards
         (run_id, shop_id, shard_key, phase_name, source_table, min_source_id, max_source_id, status, metadata, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, now())
       ON CONFLICT (run_id, phase_name, source_table, shard_key)
       DO UPDATE
          SET status = 'pending',
              error_message = NULL,
              worker_name = NULL,
              started_at = NULL,
              completed_at = NULL,
              metadata = EXCLUDED.metadata
       RETURNING id`,
      [
        params.runId,
        params.shopId,
        shard.shardKey,
        params.nextPhase,
        shard.sourceTable,
        shard.minSourceId,
        shard.maxSourceId,
        JSON.stringify({
          ...(shard.metadata ?? {}),
          clonedFromPhase: params.phaseName,
        }),
      ]
    );

    const shardId = inserted.rows[0]?.id;
    if (shardId) {
      createdShardIds.push(shardId);
    }
  }

  return createdShardIds;
}

export async function advanceLexRunPhaseIfComplete(params: {
  shopId: string;
  runId: string;
  phaseName: LexPhaseName;
  logger: Logger;
}): Promise<void> {
  await withLexAdvisoryLock({
    shopId: params.shopId,
    scope: `lex-run-phase:${params.runId}:${params.phaseName}`,
    fn: async (client) => {
      const pending = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM lex_run_shards
         WHERE run_id = $1
           AND shop_id = $2
           AND phase_name = $3
           AND status IN ('pending', 'running', 'retrying')`,
        [params.runId, params.shopId, params.phaseName]
      );

      if (Number(pending.rows[0]?.count ?? 0) > 0) {
        return;
      }

      const failures = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM lex_run_shards
         WHERE run_id = $1
           AND shop_id = $2
           AND phase_name = $3
           AND status = 'failed'`,
        [params.runId, params.shopId, params.phaseName]
      );

      await recordLexPhaseEvent({
        shopId: params.shopId,
        runId: params.runId,
        phaseName: params.phaseName,
        eventType: 'phase_completed',
        details: {
          failedShards: Number(failures.rows[0]?.count ?? 0),
        },
      });

      const nextPhase = nextLexPhase(params.phaseName);
      if (!nextPhase) {
        await markLexRunCompleted({
          shopId: params.shopId,
          runId: params.runId,
          completedWithErrors: Number(failures.rows[0]?.count ?? 0) > 0,
        });
        return;
      }

      const shardIds = await cloneShardsForNextPhase({
        client,
        shopId: params.shopId,
        runId: params.runId,
        phaseName: params.phaseName,
        nextPhase,
      });

      await client.query(
        `UPDATE lex_runs
         SET current_phase = $3,
             phase_started_at = now(),
             phase_completed_at = now(),
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
        [params.runId, params.shopId, nextPhase]
      );

      await recordLexPhaseEvent({
        shopId: params.shopId,
        runId: params.runId,
        phaseName: nextPhase,
        eventType: 'phase_started',
        details: {
          shardCount: shardIds.length,
          advancedFrom: params.phaseName,
        },
      });

      const nextQueueName = LEX_PHASE_TO_QUEUE[nextPhase] as Parameters<
        typeof enqueueLexShardJob
      >[0];
      for (const shardId of shardIds) {
        await enqueueLexShardJob(nextQueueName, {
          shopId: params.shopId,
          runId: params.runId,
          shardId,
          queuePhase: nextPhase,
          requestedAt: Date.now(),
        });
      }
    },
  }).catch((error) => {
    params.logger.warn(
      {
        error,
        runId: params.runId,
        phaseName: params.phaseName,
      },
      'Skipping lexical phase advancement because the lock is busy'
    );
  });
}
