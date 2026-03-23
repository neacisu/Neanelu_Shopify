import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { configFromEnv, createQueue, type DlqEntry, toDlqQueueName } from '@app/queue-manager';

import { LEX_QUEUE_NAMES, type LexQueueName } from '../../queue/lex-queues.js';
import { recordLexPhaseEvent } from './run-lifecycle.js';

const DLQ_ALERT_THRESHOLD = 10;
const DLQ_ALERT_SAMPLE_PER_STATE = 15;

/** `phase_name` for `lex_run_phase_events` (varchar 50). */
const LEX_QUEUE_TO_PHASE_EVENT_PHASE: Readonly<Record<LexQueueName, string>> = {
  'lex.extract.fragments': 'extract.fragments',
  'lex.extract.entities': 'extract.entities',
  'lex.mine.terms': 'mine.terms',
  'lex.aggregate.stats': 'aggregate.stats',
  'lex.build.contexts': 'build.contexts',
  'lex.embed.contexts': 'embed.contexts',
  'lex.cluster.senses': 'cluster.senses',
  'lex.resolve.attributes': 'resolve.attributes',
  'lex.translate.candidates': 'translate.candidates',
  'lex.compose.localizations': 'compose.localizations',
  'lex.review.enqueue': 'review.enqueue',
  'lex.publish': 'publish',
  'lex.retention.compact': 'retention.compact',
};

function isDlqEntryShape(value: unknown): value is DlqEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['originalQueue'] === 'string' &&
    typeof record['originalJobName'] === 'string' &&
    'data' in record
  );
}

function tryLexShopIdFromPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const shopId = (data as { shopId?: unknown }).shopId;
  return typeof shopId === 'string' && shopId.trim().length > 0 ? shopId.trim() : null;
}

function tryLexRunIdFromPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const runId = (data as { runId?: unknown }).runId;
  return typeof runId === 'string' && runId.trim().length > 0 ? runId.trim() : null;
}

async function resolveLexRunIdForDlqAlert(
  shopId: string,
  hintedRunId: string | null
): Promise<string | null> {
  if (hintedRunId) return hintedRunId;
  return await withTenantContext(shopId, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT id
       FROM lex_runs
       WHERE shop_id = $1
         AND status IN ('pending', 'running', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );
    return r.rows[0]?.id ?? null;
  });
}

async function recordFirstSampledDlqAlertEvent(params: {
  queueName: LexQueueName;
  dlqCount: number;
  dlqQueue: ReturnType<typeof createQueue>;
}): Promise<boolean> {
  const states = ['waiting', 'delayed', 'active', 'failed'] as const;
  for (const state of states) {
    const jobs = await params.dlqQueue.getJobs([state], 0, DLQ_ALERT_SAMPLE_PER_STATE - 1);
    for (const job of jobs) {
      const raw: unknown = job.data;
      if (!isDlqEntryShape(raw)) continue;
      if (raw.originalQueue !== params.queueName) continue;

      const shopId = tryLexShopIdFromPayload(raw.data);
      if (!shopId) continue;

      const hintedRun = tryLexRunIdFromPayload(raw.data);
      const runId = await resolveLexRunIdForDlqAlert(shopId, hintedRun);
      if (!runId) continue;

      const phaseName = LEX_QUEUE_TO_PHASE_EVENT_PHASE[params.queueName] ?? 'publish';
      await recordLexPhaseEvent({
        shopId,
        runId,
        phaseName,
        eventType: 'dlq_depth_threshold',
        details: {
          queueName: params.queueName,
          dlqQueueName: toDlqQueueName(params.queueName),
          dlqCount: params.dlqCount,
          threshold: DLQ_ALERT_THRESHOLD,
        },
      });
      return true;
    }
  }
  return false;
}

async function tryRecordLexDlqThresholdEvent(params: {
  queueName: LexQueueName;
  dlqCount: number;
  logger: Logger;
}): Promise<void> {
  const env = loadEnv();
  const qm = { config: configFromEnv(env) };
  const dlqQueue = createQueue(qm, { name: toDlqQueueName(params.queueName) });

  try {
    await recordFirstSampledDlqAlertEvent({
      queueName: params.queueName,
      dlqCount: params.dlqCount,
      dlqQueue,
    });
  } catch (error) {
    params.logger.warn(
      { error, queueName: params.queueName },
      'Lex DLQ watchdog: failed to record lex_run_phase_events row'
    );
  } finally {
    await dlqQueue.close().catch(() => undefined);
  }
}

export async function runLexDlqWatchdogCheck(logger: Logger): Promise<void> {
  const env = loadEnv();
  const qm = { config: configFromEnv(env) };

  for (const queueName of LEX_QUEUE_NAMES) {
    const dlqQueue = createQueue(qm, { name: toDlqQueueName(queueName) });
    try {
      const dlqCounts = await dlqQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      );
      const dlqCount =
        (dlqCounts['waiting'] ?? 0) +
        (dlqCounts['active'] ?? 0) +
        (dlqCounts['delayed'] ?? 0) +
        (dlqCounts['failed'] ?? 0);

      if (dlqCount <= DLQ_ALERT_THRESHOLD) continue;

      logger.warn(
        {
          queueName,
          dlqQueueName: toDlqQueueName(queueName),
          dlqCount,
          threshold: DLQ_ALERT_THRESHOLD,
        },
        '[CRITICAL] lex_dlq_depth_exceeded'
      );

      await tryRecordLexDlqThresholdEvent({ queueName, dlqCount, logger });
    } catch (error) {
      logger.warn({ error, queueName }, 'Lex DLQ watchdog: failed to read DLQ metrics');
    } finally {
      await dlqQueue.close().catch(() => undefined);
    }
  }
}
