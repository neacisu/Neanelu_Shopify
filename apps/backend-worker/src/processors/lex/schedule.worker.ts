import { CronExpressionParser } from 'cron-parser';

import type { Logger } from '@app/logger';
import { pool, withTenantContext, type QueryResult } from '@app/database';

import type { LexQueueName } from '../../queue/lex-queues.js';
import {
  enqueueLexPublishJob,
  enqueueLexRetentionJob,
  enqueueLexRunRequestedJob,
  forceEnqueueLexShardJob,
} from '../../queue/lex-queues.js';
import { computeLexGlossaryRulesSnapshotHash } from '../../services/lex-glossary-rules-snapshot.js';
import { evaluateLexGuardrailsMode } from '../../services/lex-guardrails.js';
import {
  findLexReuseFragmentsRunId,
  insertTranslateOnlyRunShards,
} from '../../services/lex-translate-only-bootstrap.js';
import { runLexDlqWatchdogCheck } from './lex-dlq-watchdog.js';
import { advanceLexRunPhaseIfComplete } from './run-lifecycle.js';
import { parseLexWatchdogShopBatchSize } from './schedule-watchdog-config.js';
import { LEX_PHASE_TO_QUEUE, isLexPhaseName, type LexPhaseName } from './phases.js';
import type { TenantClient } from './pipeline-types.js';

export interface LexScheduleWorkerHandle {
  worker: { isRunning?: () => boolean };
  close: () => Promise<void>;
  isRunning: () => boolean;
}

type ScheduledTaskRow = Readonly<{
  id: string;
  shopId: string;
  taskName: string;
  cronExpression: string;
  jobData: Record<string, unknown> | null;
  nextRunAt: Date | null;
}>;

/** Row shape for `checkGuardrailsAutoSwitch` shop pagination (lex_shop_settings + shops join). */
interface ProgressiveLexShopRow {
  shopId: string;
  guardrailsLastEvaluatedAt: Date | null;
}

function parseEntityTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return ['product', 'variant', 'collection'];
  const values = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return values.length > 0 ? values : ['product', 'variant', 'collection'];
}

function deriveSourceTables(extractScope: Record<string, unknown>): string[] {
  const entityTypes = parseEntityTypes(extractScope['entityTypes']);
  const map = new Map<string, string>([
    ['product', 'shopify_products'],
    ['variant', 'shopify_variants'],
    ['collection', 'shopify_collections'],
    ['master_product', 'prod_master'],
  ]);

  return entityTypes
    .map((entityType) => map.get(entityType))
    .filter((value): value is string => typeof value === 'string');
}

function safeNextRun(cronExpression: string, baseDate: Date): Date | null {
  try {
    const iter = CronExpressionParser.parse(cronExpression, {
      tz: 'UTC',
      currentDate: baseDate,
    });
    return iter.next().toDate();
  } catch {
    return null;
  }
}

async function dispatchLexScheduledTask(params: {
  row: ScheduledTaskRow;
  logger: Logger;
}): Promise<void> {
  const triggeredAt = Date.now();
  const runType =
    params.row.jobData?.['runType'] === 'full_rebuild' ||
    params.row.jobData?.['runType'] === 'delta_rebuild' ||
    params.row.jobData?.['runType'] === 'context_rebuild' ||
    params.row.jobData?.['runType'] === 'translate_only' ||
    params.row.jobData?.['runType'] === 'publish_only'
      ? params.row.jobData['runType']
      : null;

  if (params.row.taskName === 'lex.publish.retry') {
    await enqueueLexPublishJob({
      shopId: params.row.shopId,
      requestedAt: triggeredAt,
      retryOnly: true,
    });
    return;
  }

  if (params.row.taskName === 'lex.retention.compact') {
    await enqueueLexRetentionJob({
      shopId: params.row.shopId,
      requestedAt: triggeredAt,
    });
    return;
  }

  if (runType) {
    const runRow = await withTenantContext(params.row.shopId, async (client) => {
      const active = await client.query<{ id: string }>(
        `SELECT id
         FROM lex_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running', 'paused')
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.row.shopId]
      );
      if (active.rows[0]?.id) {
        return { activeRunId: active.rows[0].id, runId: null, skipReason: null };
      }

      const extractScope =
        (params.row.jobData?.['extractScope'] &&
        typeof params.row.jobData['extractScope'] === 'object' &&
        !Array.isArray(params.row.jobData['extractScope'])
          ? (params.row.jobData['extractScope'] as Record<string, unknown>)
          : {}) ?? {};
      const scopeJson = JSON.stringify(extractScope);

      let sourceTables = deriveSourceTables(extractScope);
      if (sourceTables.length === 0) {
        sourceTables = ['shopify_products'];
      }

      if (runType === 'translate_only') {
        const reuseFragmentsRunId = await findLexReuseFragmentsRunId(
          client,
          params.row.shopId,
          sourceTables
        );
        if (!reuseFragmentsRunId) {
          return {
            activeRunId: null,
            runId: null,
            skipReason: 'translate_only_no_base_run' as const,
          };
        }

        const glossaryRulesSnapshotHash = await computeLexGlossaryRulesSnapshotHash(
          client,
          params.row.shopId
        );
        const runMetadata = {
          requested_via: 'scheduler',
          translate_only: true,
          reuse_fragments_run_id: reuseFragmentsRunId,
          glossary_rules_snapshot_hash: glossaryRulesSnapshotHash,
        };

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO lex_runs
             (shop_id, run_type, source_scope, current_phase, status, metadata, created_at, updated_at)
           VALUES
             ($1, $2, $3::jsonb, 'translate.candidates', 'pending', $4::jsonb, now(), now())
           RETURNING id`,
          [params.row.shopId, runType, scopeJson, JSON.stringify(runMetadata)]
        );

        const runId = inserted.rows[0]?.id ?? null;
        if (!runId) {
          return { activeRunId: null, runId: null, skipReason: null };
        }

        await insertTranslateOnlyRunShards({
          client,
          shopId: params.row.shopId,
          runId,
          reuseFragmentsRunId,
          sourceTables,
          extraShardMetadata: { scheduledTaskId: params.row.id },
        });

        return { activeRunId: null, runId, skipReason: null };
      }

      const glossaryRulesSnapshotHashFull = await computeLexGlossaryRulesSnapshotHash(
        client,
        params.row.shopId
      );
      const fullRunMetadata = JSON.stringify({
        requested_via: 'scheduler',
        glossary_rules_snapshot_hash: glossaryRulesSnapshotHashFull,
      });

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO lex_runs
           (shop_id, run_type, source_scope, current_phase, status, metadata, created_at, updated_at)
         VALUES
           ($1, $2, $3::jsonb, 'extract.fragments', 'pending', $4::jsonb, now(), now())
         RETURNING id`,
        [params.row.shopId, runType, scopeJson, fullRunMetadata]
      );

      const runId = inserted.rows[0]?.id ?? null;
      if (!runId) {
        return { activeRunId: null, runId: null, skipReason: null };
      }

      for (const sourceTable of sourceTables) {
        await client.query(
          `INSERT INTO lex_run_shards
             (run_id, shop_id, shard_key, phase_name, source_table, status, metadata, created_at)
           VALUES
             ($1, $2, $3, 'extract.fragments', $4, 'pending', $5::jsonb, now())`,
          [
            runId,
            params.row.shopId,
            `${sourceTable}:all`,
            sourceTable,
            JSON.stringify({
              sourceTable,
              scheduledTaskId: params.row.id,
            }),
          ]
        );
      }

      return { activeRunId: null, runId, skipReason: null };
    });

    if (runRow.skipReason === 'translate_only_no_base_run') {
      params.logger.warn(
        { shopId: params.row.shopId, taskId: params.row.id },
        'lex_scheduled_translate_only_skipped_no_base_run'
      );
    }

    if (runRow.activeRunId || !runRow.runId) {
      return;
    }

    await enqueueLexRunRequestedJob({
      shopId: params.row.shopId,
      runId: runRow.runId,
      runType,
      triggeredBy: 'scheduler',
      requestedAt: triggeredAt,
      sourceScope: {},
    });
  }
}

async function runLexWatchdogShardRecoveryQueries(
  client: TenantClient,
  ctx: {
    runId: string;
    shopId: string;
    phaseName: LexPhaseName;
    queueName: LexQueueName;
    logger: Logger;
  }
): Promise<boolean> {
  const { runId, shopId, phaseName, queueName, logger } = ctx;

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
      'Lex watchdog: reset stale running shards to pending'
    );
  }

  const runningCount = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM lex_run_shards
     WHERE run_id = $1
       AND shop_id = $2
       AND phase_name = $3
       AND status = 'running'`,
    [runId, shopId, phaseName]
  );

  const hasActiveShards = Number(runningCount.rows[0]?.count ?? 0) > 0;
  if (hasActiveShards) {
    return false;
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

  if (pendingShards.rows.length > 0) {
    logger.warn(
      {
        runId,
        shopId,
        phase: phaseName,
        count: pendingShards.rows.length,
      },
      'Lex watchdog: re-enqueuing orphaned pending shards'
    );

    for (const shard of pendingShards.rows) {
      await forceEnqueueLexShardJob(queueName, {
        shopId,
        runId,
        shardId: shard.id,
        queuePhase: phaseName,
        requestedAt: Date.now(),
      });
    }
  }

  const phaseStats = await client.query<{ total: string; active: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status IN ('pending', 'running', 'retrying'))::text AS active
     FROM lex_run_shards
     WHERE run_id = $1
       AND shop_id = $2
       AND phase_name = $3`,
    [runId, shopId, phaseName]
  );
  const totalShards = Number(phaseStats.rows[0]?.total ?? 0);
  const activeShards = Number(phaseStats.rows[0]?.active ?? 0);
  return totalShards > 0 && activeShards === 0;
}

type LexWatchdogActiveRunRow = Readonly<{ runId: string; currentPhase: string }>;

async function loadActiveLexRunsForWatchdog(shopId: string): Promise<LexWatchdogActiveRunRow[]> {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<LexWatchdogActiveRunRow>(
      `SELECT
         id AS "runId",
         current_phase AS "currentPhase"
       FROM lex_runs
       WHERE shop_id = $1
         AND status = 'running'
         AND started_at < now() - interval '5 minutes'
       ORDER BY created_at ASC
       LIMIT 10`,
      [shopId]
    );
    return result.rows;
  });
}

async function processLexWatchdogRunForShop(params: {
  shopId: string;
  run: LexWatchdogActiveRunRow;
  logger: Logger;
}): Promise<void> {
  const { shopId, run, logger } = params;
  if (!isLexPhaseName(run.currentPhase)) {
    return;
  }

  try {
    const phaseName = run.currentPhase;
    const queueName = LEX_PHASE_TO_QUEUE[phaseName];
    const retryPhaseAdvance = await withTenantContext(shopId, (client) =>
      runLexWatchdogShardRecoveryQueries(client, {
        runId: run.runId,
        shopId,
        phaseName,
        queueName,
        logger,
      })
    );

    if (retryPhaseAdvance) {
      logger.warn(
        { runId: run.runId, shopId, phase: phaseName },
        'Lex watchdog: all shards terminal for phase but run still on phase; retrying advanceLexRunPhaseIfComplete'
      );
      await advanceLexRunPhaseIfComplete({
        shopId,
        runId: run.runId,
        phaseName,
        logger,
      });
    }
  } catch (error) {
    logger.warn(
      { error, runId: run.runId, shopId },
      'Lex watchdog: failed to recover shards for run'
    );
  }
}

async function processLexWatchdogShopPageRow(
  shop: Readonly<{ id: string }>,
  logger: Logger
): Promise<void> {
  let activeRuns: LexWatchdogActiveRunRow[];
  try {
    activeRuns = await loadActiveLexRunsForWatchdog(shop.id);
  } catch (error) {
    logger.warn({ error, shopId: shop.id }, 'Lex watchdog: failed to query runs for shop');
    return;
  }

  for (const run of activeRuns) {
    await processLexWatchdogRunForShop({ shopId: shop.id, run, logger });
  }
}

// Stale shard watchdog: reset shards stuck in 'running' > 45 min and re-enqueue
// all pending shards for phases that have no active worker (orphaned BullMQ jobs).
//
// NOTE: `lex_runs` has forced RLS (tenant isolation). The `pool.query()` on `lex_runs`
// would return 0 rows without an RLS context. We therefore iterate over the `shops`
// table (which has no RLS) to discover tenant IDs, then use `withTenantContext` per
// shop for all subsequent queries.
export async function runLexShardWatchdogTick(logger: Logger): Promise<void> {
  const batchSize = parseLexWatchdogShopBatchSize();
  let lastShopId: string | null = null;

  for (;;) {
    const shopPage: QueryResult<{ id: string }> = await pool.query<{ id: string }>(
      lastShopId == null
        ? `SELECT id FROM shops WHERE uninstalled_at IS NULL ORDER BY id LIMIT $1`
        : `SELECT id FROM shops WHERE uninstalled_at IS NULL AND id > $2 ORDER BY id LIMIT $1`,
      lastShopId == null ? [batchSize] : [batchSize, lastShopId]
    );

    if (shopPage.rows.length === 0) break;

    for (const shop of shopPage.rows) {
      await processLexWatchdogShopPageRow(shop, logger);
    }

    const tailShop = shopPage.rows.at(-1);
    if (tailShop) {
      lastShopId = tailShop.id;
    }
  }
}

/** Interval between guardrails mode re-evaluations for progressive shops (g3-03). */
const GUARDRAILS_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

async function evaluateGuardrailsAutoSwitchForShop(
  shop: ProgressiveLexShopRow,
  logger: Logger
): Promise<void> {
  const lastEval = shop.guardrailsLastEvaluatedAt;
  if (lastEval && Date.now() - lastEval.getTime() < GUARDRAILS_CHECK_INTERVAL_MS) {
    return;
  }

  try {
    const result = await withTenantContext(shop.shopId, async (client) => {
      return evaluateLexGuardrailsMode({ shopId: shop.shopId, client });
    });

    if (result.switched) {
      logger.info(
        { shopId: shop.shopId, newMode: result.currentMode },
        'guardrails_auto_switch_progressive_to_enforce'
      );
    }
  } catch (error) {
    logger.warn({ error, shopId: shop.shopId }, 'guardrails_auto_switch_check_failed');
  }
}

/**
 * g3-03: Weekly auto-switch from progressive → enforce for qualifying shops.
 * Criteria: warn_count >= 1000 AND false_positive_rate < 5%.
 */
export async function checkGuardrailsAutoSwitch(logger: Logger): Promise<void> {
  const batchSize = 200;
  let lastShopId: string | null = null;

  for (;;) {
    const shopPage: QueryResult<ProgressiveLexShopRow> = await pool.query<ProgressiveLexShopRow>(
      lastShopId == null
        ? `SELECT ls.shop_id AS "shopId",
                  ls.guardrails_last_evaluated_at AS "guardrailsLastEvaluatedAt"
             FROM lex_shop_settings ls
             JOIN shops s ON s.id = ls.shop_id AND s.uninstalled_at IS NULL
            WHERE ls.guardrails_lex_mode = 'progressive'
            ORDER BY ls.shop_id
            LIMIT $1`
        : `SELECT ls.shop_id AS "shopId",
                  ls.guardrails_last_evaluated_at AS "guardrailsLastEvaluatedAt"
             FROM lex_shop_settings ls
             JOIN shops s ON s.id = ls.shop_id AND s.uninstalled_at IS NULL
            WHERE ls.guardrails_lex_mode = 'progressive'
              AND ls.shop_id > $2
            ORDER BY ls.shop_id
            LIMIT $1`,
      lastShopId == null ? [batchSize] : [batchSize, lastShopId]
    );

    if (shopPage.rows.length === 0) break;

    for (const shop of shopPage.rows) {
      await evaluateGuardrailsAutoSwitchForShop(shop, logger);
    }

    const tail = shopPage.rows.at(-1);
    if (tail) {
      lastShopId = tail.shopId;
    }
  }
}

export async function runLexScheduleTick(logger: Logger): Promise<void> {
  const now = new Date();
  const dueTasks = await pool.query<ScheduledTaskRow>(
    `SELECT
       id,
       shop_id AS "shopId",
       task_name AS "taskName",
       cron_expression AS "cronExpression",
       job_data AS "jobData",
       next_run_at AS "nextRunAt"
     FROM scheduled_tasks
     WHERE is_active = true
       AND task_name IN ('lex.delta.rebuild', 'lex.publish.retry', 'lex.retention.compact')
       AND (next_run_at IS NULL OR next_run_at <= $1)
     ORDER BY next_run_at NULLS FIRST`,
    [now.toISOString()]
  );

  for (const row of dueTasks.rows) {
    await dispatchLexScheduledTask({ row, logger });
    const nextRun = safeNextRun(row.cronExpression, now);

    await withTenantContext(row.shopId, async (client) => {
      await client.query(
        `UPDATE scheduled_tasks
         SET last_run_at = $2,
             next_run_at = $3,
             run_count = COALESCE(run_count, 0) + 1,
             updated_at = now()
         WHERE shop_id = $1
           AND id = $4`,
        [row.shopId, now.toISOString(), nextRun?.toISOString() ?? null, row.id]
      );
    });
  }
}

export function startLexScheduleWorker(logger: Logger): LexScheduleWorkerHandle {
  const tickSeconds = Number(process.env['LEX_SCHEDULE_TICK_SECONDS'] ?? 30);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 1 ? tickSeconds * 1000 : 30_000;
  const watchdogIntervalTicks = 10; // run watchdog every ~5 min (10 × 30s ticks)
  const guardrailsCheckIntervalTicks = 20; // check guardrails auto-switch every ~10 min

  let running = false;
  let closed = false;
  let tickCount = 0;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runLexScheduleTick(logger);
      tickCount += 1;
      if (tickCount % watchdogIntervalTicks === 0) {
        await runLexShardWatchdogTick(logger);
        await runLexDlqWatchdogCheck(logger);
      }
      if (tickCount % guardrailsCheckIntervalTicks === 0) {
        await checkGuardrailsAutoSwitch(logger);
      }
    } catch (error) {
      logger.error({ error }, 'Lexical schedule tick failed');
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), tickMs);
  void tick();

  return {
    worker: {
      isRunning: () => !closed,
    },
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.resolve();
    },
    isRunning: () => !closed,
  };
}
