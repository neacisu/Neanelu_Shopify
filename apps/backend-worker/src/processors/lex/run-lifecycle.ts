import type { Logger } from '@app/logger';
import { logAuditEvent, withTenantContext } from '@app/database';

import {
  forceEnqueueLexShardJob,
  lexRunTypePriority,
  type LexQueueName,
} from '../../queue/lex-queues.js';
import { type LexPhaseName, isLexPhaseName, nextLexPhase, LEX_PHASE_TO_QUEUE } from './phases.js';
import { withLexAdvisoryLock } from './advisory-locks.js';
import type { TenantClient } from './pipeline-types.js';

const REDIS_ENQUEUE_BACKOFF_MS = [1000, 2000, 4000] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface LexPhaseAdvanceEnqueuePlan {
  nextQueueName: LexQueueName;
  nextPhase: LexPhaseName;
  shardIds: readonly string[];
  shopId: string;
  runId: string;
  priority?: number;
}

async function enqueueLexShardJobsWithRedisRetry(params: {
  plan: LexPhaseAdvanceEnqueuePlan;
  logger: Logger;
}): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      for (const shardId of params.plan.shardIds) {
        // forceEnqueue: același motiv ca recoverLexRun + watchdog (f3-07) — evită no-op când
        // jobId-ul rămâne în :completed/:failed (Redis LRU / retry după fază completă).
        const shardEnqueueOptions =
          params.plan.priority === undefined ? undefined : { priority: params.plan.priority };
        await forceEnqueueLexShardJob(
          params.plan.nextQueueName,
          {
            shopId: params.plan.shopId,
            runId: params.plan.runId,
            shardId,
            queuePhase: params.plan.nextPhase,
            requestedAt: Date.now(),
          },
          shardEnqueueOptions
        );
      }
      return true;
    } catch (error) {
      const waitMs = REDIS_ENQUEUE_BACKOFF_MS[attempt];
      if (waitMs === undefined) {
        params.logger.fatal(
          {
            err: error,
            runId: params.plan.runId,
            shopId: params.plan.shopId,
            phase: params.plan.nextPhase,
            shardCount: params.plan.shardIds.length,
            attempts: attempt + 1,
          },
          '[CRITICAL] Redis indisponibil: forceEnqueueLexShardJob a eșuat după 3 reîncercări; run oprit (redis_unavailable)'
        );
        return false;
      }
      params.logger.warn(
        {
          err: error,
          runId: params.plan.runId,
          shopId: params.plan.shopId,
          phase: params.plan.nextPhase,
          attempt: attempt + 1,
          nextRetryMs: waitMs,
        },
        'forceEnqueueLexShardJob a eșuat; reîncercare după backoff (Redis)'
      );
      await delay(waitMs);
    }
  }
}

export async function recordLexPhaseEvent(params: {
  shopId: string;
  runId: string;
  shardId?: string | null;
  phaseName: string;
  eventType: string;
  details?: Record<string, unknown>;
  /** Dacă e setat, INSERT-ul rulează pe aceeași conexiune (ex. în `withLexAdvisoryLock`). */
  client?: TenantClient;
}): Promise<void> {
  const insert = async (c: TenantClient): Promise<void> => {
    await c.query(
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
  };

  if (params.client) {
    await insert(params.client);
    return;
  }

  await withTenantContext(params.shopId, async (c) => {
    await insert(c);
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
           completed_with_errors = COALESCE(completed_with_errors, false) OR $3,
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
         s.id,
         s.run_id AS "runId",
         s.shop_id AS "shopId",
         s.phase_name AS "phaseName",
         s.source_table AS "sourceTable",
         s.status,
         s.metadata
       FROM lex_run_shards s
       INNER JOIN lex_runs r
         ON r.id = s.run_id
         AND r.shop_id = s.shop_id
       WHERE s.id = $1
         AND s.run_id = $2
         AND s.shop_id = $3
         AND r.status NOT IN ('cancelled', 'failed')
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
          ...shard.metadata,
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
  let enqueuePlan: LexPhaseAdvanceEnqueuePlan | null;

  try {
    enqueuePlan = await withLexAdvisoryLock({
      shopId: params.shopId,
      scope: `lex-run-phase:${params.runId}:${params.phaseName}`,
      fn: async (client): Promise<LexPhaseAdvanceEnqueuePlan | null> => {
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
          return null;
        }

        const phaseTotals = await client.query<{ total: string; failed: string }>(
          `SELECT
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
           FROM lex_run_shards
           WHERE run_id = $1
             AND shop_id = $2
             AND phase_name = $3`,
          [params.runId, params.shopId, params.phaseName]
        );

        const totalShards = Number(phaseTotals.rows[0]?.total ?? 0);
        const failedShards = Number(phaseTotals.rows[0]?.failed ?? 0);
        const completedShards = totalShards - failedShards;

        await recordLexPhaseEvent({
          shopId: params.shopId,
          runId: params.runId,
          phaseName: params.phaseName,
          eventType: 'phase_completed',
          details: {
            failedShards,
            totalShards,
          },
          client,
        });

        const nextPhase = nextLexPhase(params.phaseName);

        if (totalShards === 0) {
          if (nextPhase) {
            await markLexRunFailed({
              shopId: params.shopId,
              runId: params.runId,
              errorMessage: `lex_phase_advance_zero_shards:${params.phaseName}`,
            });
            await logAuditEvent('lex_run_failed', {
              actorType: 'system',
              shopId: params.shopId,
              resourceType: 'lex_runs',
              resourceId: params.runId,
              details: {
                status: 'failed',
                phase: params.phaseName,
                errorMessage: `lex_phase_advance_zero_shards:${params.phaseName}`,
              },
            });
          } else {
            await markLexRunCompleted({
              shopId: params.shopId,
              runId: params.runId,
              completedWithErrors: true,
            });
            await logAuditEvent('lex_run_completed', {
              actorType: 'system',
              shopId: params.shopId,
              resourceType: 'lex_runs',
              resourceId: params.runId,
              details: {
                status: 'completed_with_errors',
                phase: params.phaseName,
                totalShards: 0,
                failedShards: 0,
              },
            });
          }
          return null;
        }

        if (completedShards === 0) {
          await markLexRunFailed({
            shopId: params.shopId,
            runId: params.runId,
            errorMessage: `lex_phase_all_shards_failed:${params.phaseName}`,
          });
          await logAuditEvent('lex_run_failed', {
            actorType: 'system',
            shopId: params.shopId,
            resourceType: 'lex_runs',
            resourceId: params.runId,
            details: {
              status: 'failed',
              phase: params.phaseName,
              totalShards,
              failedShards,
              errorMessage: `lex_phase_all_shards_failed:${params.phaseName}`,
            },
          });
          return null;
        }

        if (nextPhase) {
          const shardIds = await cloneShardsForNextPhase({
            client,
            shopId: params.shopId,
            runId: params.runId,
            phaseName: params.phaseName,
            nextPhase,
          });

          if (shardIds.length === 0) {
            params.logger.error(
              {
                runId: params.runId,
                shopId: params.shopId,
                phaseName: params.phaseName,
                nextPhase,
                completedShards,
              },
              'advanceLexRunPhaseIfComplete: cloneShardsForNextPhase returned no shards despite completedShards>0'
            );
            await markLexRunFailed({
              shopId: params.shopId,
              runId: params.runId,
              errorMessage: `lex_phase_advance_clone_empty:${params.phaseName}->${nextPhase}`,
            });
            await logAuditEvent('lex_run_failed', {
              actorType: 'system',
              shopId: params.shopId,
              resourceType: 'lex_runs',
              resourceId: params.runId,
              details: {
                status: 'failed',
                phase: params.phaseName,
                errorMessage: `lex_phase_advance_clone_empty:${params.phaseName}->${nextPhase}`,
              },
            });
            return null;
          }

          await client.query(
            `UPDATE lex_runs
         SET current_phase = $3,
             phase_started_at = now(),
             phase_completed_at = NULL,
             completed_with_errors = COALESCE(completed_with_errors, false) OR ($4::int > 0),
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
            [params.runId, params.shopId, nextPhase, failedShards]
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
            client,
          });

          const runTypeRow = await client.query<{ runType: string | null }>(
            `SELECT run_type AS "runType" FROM lex_runs WHERE id = $1 AND shop_id = $2 LIMIT 1`,
            [params.runId, params.shopId]
          );

          const nextQueueName = LEX_PHASE_TO_QUEUE[nextPhase];
          return {
            nextQueueName,
            nextPhase,
            shardIds,
            shopId: params.shopId,
            runId: params.runId,
            priority: lexRunTypePriority(runTypeRow.rows[0]?.runType),
          };
        }

        const finalStatus = failedShards > 0 ? 'completed_with_errors' : 'completed';
        await markLexRunCompleted({
          shopId: params.shopId,
          runId: params.runId,
          completedWithErrors: failedShards > 0,
        });
        await logAuditEvent('lex_run_completed', {
          actorType: 'system',
          shopId: params.shopId,
          resourceType: 'lex_runs',
          resourceId: params.runId,
          details: { status: finalStatus, phase: params.phaseName, totalShards, failedShards },
        });
        return null;
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('lex_advisory_lock_busy:')) {
      params.logger.warn(
        {
          error,
          runId: params.runId,
          phaseName: params.phaseName,
        },
        'Skipping lexical phase advancement because the lock is busy'
      );
      return;
    }
    params.logger.error(
      {
        err: error,
        runId: params.runId,
        phaseName: params.phaseName,
      },
      'advanceLexRunPhaseIfComplete: eroare neașteptată în tranzacția de avansare fază'
    );
    throw error;
  }

  if (!enqueuePlan || enqueuePlan.shardIds.length === 0) {
    return;
  }

  const enqueued = await enqueueLexShardJobsWithRedisRetry({
    plan: enqueuePlan,
    logger: params.logger,
  });

  if (!enqueued) {
    await markLexRunPaused({
      shopId: enqueuePlan.shopId,
      runId: enqueuePlan.runId,
      pauseReason: 'redis_unavailable',
      errorMessage: 'Nu s-au putut pune job-urile în coadă după reîncercări (Redis).',
    });
    await recordLexPhaseEvent({
      shopId: enqueuePlan.shopId,
      runId: enqueuePlan.runId,
      phaseName: enqueuePlan.nextPhase,
      eventType: 'enqueue_redis_failed',
      details: {
        shardCount: enqueuePlan.shardIds.length,
        pauseReason: 'redis_unavailable',
      },
    });
  }
}

export interface LexCheckpointInfo {
  lastCompletedPhase: LexPhaseName | null;
  lastCompletedShardIndex: number;
  remainingShards: { id: string; phaseName: LexPhaseName; status: string }[];
}

export async function loadLexCheckpoint(params: {
  shopId: string;
  runId: string;
}): Promise<LexCheckpointInfo> {
  return await withTenantContext(params.shopId, async (client) => {
    const completedShards = await client.query<{
      id: string;
      phaseName: string;
      completedAt: string | null;
    }>(
      `SELECT id, phase_name AS "phaseName", completed_at AS "completedAt"
       FROM lex_run_shards
       WHERE run_id = $1
         AND shop_id = $2
         AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST, created_at DESC`,
      [params.runId, params.shopId]
    );

    let lastCompletedPhase: LexPhaseName | null = null;
    if (completedShards.rows.length > 0) {
      const phase = completedShards.rows[0]!.phaseName;
      if (isLexPhaseName(phase)) {
        lastCompletedPhase = phase;
      }
    }

    const remaining = await client.query<{
      id: string;
      phaseName: string;
      status: string;
    }>(
      `SELECT id, phase_name AS "phaseName", status
       FROM lex_run_shards
       WHERE run_id = $1
         AND shop_id = $2
         AND status IN ('pending', 'running', 'retrying', 'failed')
       ORDER BY created_at ASC`,
      [params.runId, params.shopId]
    );

    return {
      lastCompletedPhase,
      lastCompletedShardIndex: completedShards.rows.length - 1,
      remainingShards: remaining.rows
        .filter((r) => isLexPhaseName(r.phaseName))
        .map((r) => ({
          id: r.id,
          phaseName: r.phaseName as LexPhaseName,
          status: r.status,
        })),
    };
  });
}

interface RecoverLexTenantOutcome {
  result: { recovered: boolean; reason: string };
  retryAdvancePhase: LexPhaseName | null;
}

async function resetStaleAndFailedLexShardsThenListPending(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  phaseName: LexPhaseName;
  logger: Logger;
}): Promise<{
  staleReset: { rowCount: number | null };
  failedReset: { rowCount: number | null };
  pendingShards: { rows: { id: string }[] };
}> {
  const { client, shopId, runId, phaseName, logger } = params;

  const staleReset = await client.query<{ id: string }>(
    `UPDATE lex_run_shards
       SET status = 'pending',
           worker_name = NULL,
           started_at = NULL
       WHERE run_id = $1
         AND shop_id = $2
         AND phase_name = $3
         AND status = 'running'
         AND started_at < now() - interval '45 minutes'
       RETURNING id`,
    [runId, shopId, phaseName]
  );

  if (staleReset.rowCount && staleReset.rowCount > 0) {
    logger.warn(
      { runId, shopId, phase: phaseName, count: staleReset.rowCount },
      'recoverLexRun: reset stale running shards to pending'
    );
  }

  const failedReset = await client.query<{ id: string }>(
    `UPDATE lex_run_shards
       SET status = 'pending',
           error_message = NULL,
           worker_name = NULL,
           started_at = NULL
       WHERE run_id = $1
         AND shop_id = $2
         AND phase_name = $3
         AND status = 'failed'
       RETURNING id`,
    [runId, shopId, phaseName]
  );

  if (failedReset.rowCount && failedReset.rowCount > 0) {
    logger.warn(
      { runId, shopId, phase: phaseName, count: failedReset.rowCount },
      'recoverLexRun: reset failed shards to pending'
    );
  }

  const pendingShards = await client.query<{ id: string }>(
    `SELECT id
       FROM lex_run_shards
       WHERE run_id = $1
         AND shop_id = $2
         AND phase_name = $3
         AND status = 'pending'`,
    [runId, shopId, phaseName]
  );

  return { staleReset, failedReset, pendingShards };
}

async function recoverLexRunInTenant(
  client: TenantClient,
  params: { shopId: string; runId: string; logger: Logger }
): Promise<RecoverLexTenantOutcome> {
  const runRes = await client.query<{
    status: string;
    currentPhase: string | null;
  }>(
    `SELECT status, current_phase AS "currentPhase"
       FROM lex_runs
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
    [params.runId, params.shopId]
  );

  const run = runRes.rows[0];
  if (!run) {
    return { result: { recovered: false, reason: 'run_not_found' }, retryAdvancePhase: null };
  }

  const { status, currentPhase } = run;

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return {
      result: { recovered: false, reason: `run_already_terminal:${status}` },
      retryAdvancePhase: null,
    };
  }

  if (!currentPhase) {
    return { result: { recovered: false, reason: 'run_has_no_phase' }, retryAdvancePhase: null };
  }

  if (!isLexPhaseName(currentPhase)) {
    params.logger.error(
      {
        runId: params.runId,
        shopId: params.shopId,
        currentPhase,
      },
      'recoverLexRun: encountered invalid current phase in lex_runs'
    );
    return {
      result: { recovered: false, reason: `unknown_phase:${currentPhase}` },
      retryAdvancePhase: null,
    };
  }

  const phaseName = currentPhase;
  const queueName = LEX_PHASE_TO_QUEUE[phaseName];

  const checkpoint = await loadLexCheckpoint({
    shopId: params.shopId,
    runId: params.runId,
  });

  if (checkpoint.lastCompletedPhase && checkpoint.remainingShards.length === 0) {
    params.logger.info(
      {
        runId: params.runId,
        shopId: params.shopId,
        phase: phaseName,
        lastCompletedPhase: checkpoint.lastCompletedPhase,
        completedShards: checkpoint.lastCompletedShardIndex + 1,
      },
      'recoverLexRun: all shards completed via checkpoint; retrying phase advance'
    );
    return {
      result: { recovered: true, reason: 'checkpoint_all_complete' },
      retryAdvancePhase: phaseName,
    };
  }

  // If paused, reset to running first.
  if (status === 'paused') {
    await client.query(
      `UPDATE lex_runs
         SET status = 'running',
             resumed_at = now(),
             pause_reason = NULL,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
           AND status = 'paused'`,
      [params.runId, params.shopId]
    );
  }

  const { staleReset, failedReset, pendingShards } =
    await resetStaleAndFailedLexShardsThenListPending({
      client,
      shopId: params.shopId,
      runId: params.runId,
      phaseName,
      logger: params.logger,
    });

  if (
    pendingShards.rows.length === 0 &&
    (staleReset.rowCount ?? 0) === 0 &&
    (failedReset.rowCount ?? 0) === 0
  ) {
    let retryAdvancePhase: LexPhaseName | null = null;
    const phaseShardTotal = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM lex_run_shards
         WHERE run_id = $1
           AND shop_id = $2
           AND phase_name = $3`,
      [params.runId, params.shopId, phaseName]
    );
    if (Number(phaseShardTotal.rows[0]?.c ?? 0) === 0) {
      retryAdvancePhase = phaseName;
      params.logger.warn(
        { runId: params.runId, shopId: params.shopId, phase: phaseName },
        'recoverLexRun: zero shards for current phase; will retry advanceLexRunPhaseIfComplete'
      );
    }
    return {
      result: { recovered: false, reason: 'no_pending_shards_found' },
      retryAdvancePhase,
    };
  }

  for (const shard of pendingShards.rows) {
    // forceEnqueueLexShardJob clears BullMQ :completed/:failed dedup entries
    // before adding, preventing silent no-ops caused by allkeys-lru eviction.
    await forceEnqueueLexShardJob(queueName, {
      shopId: params.shopId,
      runId: params.runId,
      shardId: shard.id,
      queuePhase: phaseName,
      requestedAt: Date.now(),
    });
  }

  params.logger.info(
    {
      runId: params.runId,
      shopId: params.shopId,
      phase: phaseName,
      enqueuedShards: pendingShards.rows.length,
      resetStaleShards: staleReset.rowCount ?? 0,
      resetFailedShards: failedReset.rowCount ?? 0,
    },
    'recoverLexRun: recovery complete'
  );

  return {
    result: {
      recovered: true,
      reason: `enqueued:${pendingShards.rows.length}:stale_reset:${staleReset.rowCount ?? 0}:failed_reset:${failedReset.rowCount ?? 0}`,
    },
    retryAdvancePhase: null,
  };
}

export async function recoverLexRun(params: {
  shopId: string;
  runId: string;
  logger: Logger;
}): Promise<{ recovered: boolean; reason: string }> {
  const { result, retryAdvancePhase } = await withTenantContext(params.shopId, async (client) =>
    recoverLexRunInTenant(client, params)
  );

  if (retryAdvancePhase) {
    await advanceLexRunPhaseIfComplete({
      shopId: params.shopId,
      runId: params.runId,
      phaseName: retryAdvancePhase,
      logger: params.logger,
    });
    return { recovered: true, reason: 'recover_empty_phase_advance_retry' };
  }

  return result;
}
