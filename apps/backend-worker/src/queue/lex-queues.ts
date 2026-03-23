import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import type {
  LexComposeLocalizationJobPayload,
  LexPublishJobPayload,
  LexRetentionJobPayload,
  LexResolveAttributesJobPayload,
  LexRunRequestedJobPayload,
  LexShardJobPayload,
} from '@app/types';
import {
  validateLexComposeLocalizationJobPayload,
  validateLexPublishJobPayload,
  validateLexResolveAttributesJobPayload,
  validateLexRetentionJobPayload,
  validateLexRunRequestedJobPayload,
  validateLexShardJobPayload,
} from '@app/types';
import {
  configFromEnv,
  createQueue,
  toDlqQueueName,
  type CreateQueueManagerOptions,
  type DlqEntry,
} from '@app/queue-manager';

import { createLexJobRunRecord } from '../processors/lex/job-runs.js';

import { lexRunTypePriority } from './lex-run-priorities.js';

export { lexRunTypePriority, lexShardBatchPriority } from './lex-run-priorities.js';

const env = loadEnv();
const qmOptions: CreateQueueManagerOptions = { config: configFromEnv(env) };

export const LEX_EXTRACT_FRAGMENTS_QUEUE_NAME = 'lex.extract.fragments';
export const LEX_EXTRACT_ENTITIES_QUEUE_NAME = 'lex.extract.entities';
export const LEX_MINE_TERMS_QUEUE_NAME = 'lex.mine.terms';
export const LEX_AGGREGATE_STATS_QUEUE_NAME = 'lex.aggregate.stats';
export const LEX_BUILD_CONTEXTS_QUEUE_NAME = 'lex.build.contexts';
export const LEX_EMBED_CONTEXTS_QUEUE_NAME = 'lex.embed.contexts';
export const LEX_CLUSTER_SENSES_QUEUE_NAME = 'lex.cluster.senses';
export const LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME = 'lex.resolve.attributes';
export const LEX_TRANSLATE_CANDIDATES_QUEUE_NAME = 'lex.translate.candidates';
export const LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME = 'lex.compose.localizations';
export const LEX_REVIEW_ENQUEUE_QUEUE_NAME = 'lex.review.enqueue';
export const LEX_PUBLISH_QUEUE_NAME = 'lex.publish';
export const LEX_RETENTION_COMPACT_QUEUE_NAME = 'lex.retention.compact';

export const LEX_RUN_REQUESTED_JOB_NAME = 'lex.run.requested';
export const LEX_SHARD_PROCESS_JOB_NAME = 'lex.shard.process';
export const LEX_RESOLVE_ATTRIBUTES_JOB_NAME = 'lex.resolve.attributes';
export const LEX_COMPOSE_LOCALIZATIONS_JOB_NAME = 'lex.compose.localizations';
export const LEX_PUBLISH_JOB_NAME = 'lex.publish.request';
export const LEX_RETENTION_JOB_NAME = 'lex.retention.compact';

export const LEX_QUEUE_NAMES = [
  LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  LEX_MINE_TERMS_QUEUE_NAME,
  LEX_AGGREGATE_STATS_QUEUE_NAME,
  LEX_BUILD_CONTEXTS_QUEUE_NAME,
  LEX_EMBED_CONTEXTS_QUEUE_NAME,
  LEX_CLUSTER_SENSES_QUEUE_NAME,
  LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
  LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
  LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  LEX_REVIEW_ENQUEUE_QUEUE_NAME,
  LEX_PUBLISH_QUEUE_NAME,
  LEX_RETENTION_COMPACT_QUEUE_NAME,
] as const;

export type LexQueueName = (typeof LEX_QUEUE_NAMES)[number];
type LexQueue = ReturnType<typeof createQueue>;

const LEX_DLQ_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LEX_DLQ_RETRY_DEFAULT_MAX_JOBS = 500;

export function isLexQueueName(name: string): name is LexQueueName {
  return (LEX_QUEUE_NAMES as readonly string[]).includes(name);
}

function isDlqEntryShape(value: unknown): value is DlqEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['originalQueue'] === 'string' &&
    typeof record['originalJobName'] === 'string' &&
    'data' in record
  );
}

function lexShopIdFromOriginalPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const shopId = (data as { shopId?: unknown }).shopId;
  return typeof shopId === 'string' && shopId.trim().length > 0 ? shopId.trim() : null;
}

function dlqEntryAgeMs(jobTimestamp: number, entry: DlqEntry): number {
  const parsed = Date.parse(entry.occurredAt);
  const baseMs = Number.isFinite(parsed) ? parsed : jobTimestamp;
  return Date.now() - baseMs;
}

const LEX_DLQ_JOB_STATES = ['waiting', 'delayed', 'active', 'failed'] as const;

interface LexDlqRetryCounters {
  retried: number;
  skippedTooOld: number;
  skippedInvalid: number;
  failed: number;
}

function lexDlqRetryBudgetUsed(c: LexDlqRetryCounters): number {
  return c.retried + c.skippedTooOld + c.skippedInvalid + c.failed;
}

function normalizeLexDlqRetryMaxJobs(maxJobs: number | undefined): number {
  return typeof maxJobs === 'number' && maxJobs > 0
    ? Math.min(2000, Math.floor(maxJobs))
    : LEX_DLQ_RETRY_DEFAULT_MAX_JOBS;
}

/** BullMQ job handle shape used when draining the lex DLQ (structural typing). */
type LexDlqJobHandle = Readonly<{
  id?: string | number | null;
  timestamp?: number;
  data: unknown;
  remove(): Promise<void>;
}>;

type LexDlqReplayMainQueue = Readonly<{
  add(
    name: string,
    data: unknown,
    opts?: {
      jobId?: string;
      group?: { id: string; priority: number };
    }
  ): Promise<unknown>;
}>;

function shouldSkipLexDlqJobAsSeenDuplicate(jobKey: string, seen: Set<string>): boolean {
  if (!jobKey) return false;
  if (seen.has(jobKey)) return true;
  seen.add(jobKey);
  return false;
}

function classifyLexDlqEntryForReplay(
  entryUnknown: unknown,
  expectedQueueName: LexQueueName
): { ok: true; entry: DlqEntry } | { ok: false } {
  if (!isDlqEntryShape(entryUnknown)) return { ok: false };
  if (entryUnknown.originalQueue !== expectedQueueName) return { ok: false };
  return { ok: true, entry: entryUnknown };
}

function isLexDlqEntryPastRetryWindow(jobWallClockMs: number, entry: DlqEntry): boolean {
  return dlqEntryAgeMs(jobWallClockMs, entry) > LEX_DLQ_RETRY_MAX_AGE_MS;
}

function resolveLexDlqJobTimestamp(job: LexDlqJobHandle): number {
  return typeof job.timestamp === 'number' && Number.isFinite(job.timestamp) ? job.timestamp : 0;
}

function buildLexReplayJobId(queueName: LexQueueName, originalJobId: string | null): string {
  const safeQueue = queueName.replaceAll('.', '_');
  const now = Date.now();
  if (originalJobId) {
    return `replay__${safeQueue}__${originalJobId.replaceAll(':', '_')}__${now}`;
  }
  return `replay__${safeQueue}__${now}`;
}

async function replayLexDlqEntryOnMainQueue(params: {
  mainQueue: LexDlqReplayMainQueue;
  queueName: LexQueueName;
  job: LexDlqJobHandle;
  entry: DlqEntry;
}): Promise<'retried' | 'failed'> {
  const shopId = lexShopIdFromOriginalPayload(params.entry.data);
  const replayJobId = buildLexReplayJobId(params.queueName, params.entry.originalJobId);

  try {
    await params.mainQueue.add(params.entry.originalJobName, params.entry.data, {
      jobId: replayJobId,
      ...(shopId ? { group: { id: shopId, priority: 10 } } : {}),
    });

    if (shopId) {
      await createLexJobRunRecord({
        shopId,
        queueName: params.queueName,
        jobId: replayJobId,
        jobName: params.entry.originalJobName,
        groupId: shopId,
        payload: params.entry.data,
      });
    }

    await params.job.remove().catch(() => undefined);
    return 'retried';
  } catch {
    return 'failed';
  }
}

async function processLexDlqJobForRetry(ctx: {
  job: LexDlqJobHandle;
  queueName: LexQueueName;
  mainQueue: LexDlqReplayMainQueue;
  seen: Set<string>;
  counters: LexDlqRetryCounters;
}): Promise<void> {
  const jobKey = String(ctx.job.id ?? '');
  if (shouldSkipLexDlqJobAsSeenDuplicate(jobKey, ctx.seen)) {
    return;
  }

  const classified = classifyLexDlqEntryForReplay(ctx.job.data, ctx.queueName);
  if (!classified.ok) {
    ctx.counters.skippedInvalid += 1;
    return;
  }

  const ts = resolveLexDlqJobTimestamp(ctx.job);
  if (isLexDlqEntryPastRetryWindow(ts, classified.entry)) {
    ctx.counters.skippedTooOld += 1;
    return;
  }

  const outcome = await replayLexDlqEntryOnMainQueue({
    mainQueue: ctx.mainQueue,
    queueName: ctx.queueName,
    job: ctx.job,
    entry: classified.entry,
  });

  if (outcome === 'retried') {
    ctx.counters.retried += 1;
  } else {
    ctx.counters.failed += 1;
  }
}

type LexDlqDrainSource = Readonly<{
  getJobs(
    states: readonly string[],
    start: number,
    end: number
  ): Promise<readonly LexDlqJobHandle[]>;
}>;

async function drainLexDlqStatesIntoMainQueue(params: {
  dlqQueue: LexDlqDrainSource;
  mainQueue: LexDlqReplayMainQueue;
  queueName: LexQueueName;
  maxJobs: number;
  counters: LexDlqRetryCounters;
  seen: Set<string>;
}): Promise<void> {
  for (const state of LEX_DLQ_JOB_STATES) {
    if (lexDlqRetryBudgetUsed(params.counters) >= params.maxJobs) break;

    const remaining = params.maxJobs - lexDlqRetryBudgetUsed(params.counters);
    const end = Math.max(0, remaining - 1);
    const batch = await params.dlqQueue.getJobs([state], 0, end);

    for (const job of batch) {
      if (lexDlqRetryBudgetUsed(params.counters) >= params.maxJobs) break;

      await processLexDlqJobForRetry({
        job,
        queueName: params.queueName,
        mainQueue: params.mainQueue,
        seen: params.seen,
        counters: params.counters,
      });
    }
  }
}

export type RetryLexDlqFromMainQueueResult = Readonly<{
  retried: number;
  skipped: number;
  skippedTooOld: number;
  skippedInvalid: number;
  failed: number;
}>;

/**
 * Re-enqueue DLQ jobs back onto the given lex main queue (skips entries older than 7 days).
 * Expects BullMQ DLQ payloads shaped like {@link DlqEntry} (same as queue-manager `enableDlq`).
 */
export async function retryLexDlqToMainQueue(params: {
  env: AppEnv;
  queueName: LexQueueName;
  maxJobs?: number;
}): Promise<RetryLexDlqFromMainQueueResult> {
  const maxJobs = normalizeLexDlqRetryMaxJobs(params.maxJobs);

  const qm: CreateQueueManagerOptions = { config: configFromEnv(params.env) };
  const mainQueue = createQueue(qm, { name: params.queueName });
  const dlqQueue = createQueue(qm, { name: toDlqQueueName(params.queueName) });

  const counters: LexDlqRetryCounters = {
    retried: 0,
    skippedTooOld: 0,
    skippedInvalid: 0,
    failed: 0,
  };
  const seen = new Set<string>();

  try {
    await drainLexDlqStatesIntoMainQueue({
      dlqQueue: dlqQueue as unknown as LexDlqDrainSource,
      mainQueue: mainQueue as unknown as LexDlqReplayMainQueue,
      queueName: params.queueName,
      maxJobs,
      counters,
      seen,
    });
  } finally {
    await Promise.allSettled([mainQueue.close(), dlqQueue.close()]);
  }

  const skipped = counters.skippedTooOld + counters.skippedInvalid;
  return {
    retried: counters.retried,
    skipped,
    skippedTooOld: counters.skippedTooOld,
    skippedInvalid: counters.skippedInvalid,
    failed: counters.failed,
  };
}

const queueCache = new Map<LexQueueName, LexQueue>();

function getQueue(queueName: LexQueueName): LexQueue {
  const existing = queueCache.get(queueName);
  if (existing) return existing;

  const queue = createQueue(qmOptions, { name: queueName });
  queueCache.set(queueName, queue);
  return queue;
}

async function enqueueLexJob<TPayload>(params: {
  queueName: LexQueueName;
  jobName: string;
  jobId: string;
  shopId: string;
  payload: TPayload;
  priority?: number;
}): Promise<string> {
  const queue = getQueue(params.queueName);
  const normalizedShopId = params.shopId.trim();
  const groupPriority = params.priority ?? 10;
  const job = await queue.add(params.jobName, params.payload, {
    jobId: params.jobId,
    group: { id: normalizedShopId, priority: groupPriority },
  });

  await createLexJobRunRecord({
    shopId: normalizedShopId,
    queueName: params.queueName,
    jobId: String(job.id),
    jobName: params.jobName,
    groupId: normalizedShopId,
    payload: params.payload,
  });

  return String(job.id);
}

export async function enqueueLexRunRequestedJob(
  payload: LexRunRequestedJobPayload
): Promise<string> {
  if (!validateLexRunRequestedJobPayload(payload)) {
    throw new Error('invalid_lex_run_requested_payload');
  }

  const priority = lexRunTypePriority(payload.runType);

  return await enqueueLexJob({
    queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
    jobName: LEX_RUN_REQUESTED_JOB_NAME,
    jobId: `lex-run__${payload.shopId}__${payload.runId}`,
    shopId: payload.shopId,
    payload,
    priority,
  });
}

export async function enqueueLexShardJob(
  queueName: LexQueueName,
  payload: LexShardJobPayload,
  options?: { priority?: number }
): Promise<string> {
  if (!validateLexShardJobPayload(payload)) {
    throw new Error('invalid_lex_shard_payload');
  }

  return await enqueueLexJob({
    queueName,
    jobName: LEX_SHARD_PROCESS_JOB_NAME,
    jobId: `lex-shard__${payload.queuePhase}__${payload.shardId}`,
    shopId: payload.shopId,
    payload,
    ...(typeof options?.priority === 'number' ? { priority: options.priority } : {}),
  });
}

/**
 * Like enqueueLexShardJob but first removes any existing entry for this shard
 * from the BullMQ :completed and :failed sorted sets, guaranteeing the job is
 * always accepted even when the hash was evicted by Redis allkeys-lru or the
 * shard previously failed/completed.  Used by recoverLexRun.
 */
export async function forceEnqueueLexShardJob(
  queueName: LexQueueName,
  payload: LexShardJobPayload,
  options?: { priority?: number }
): Promise<string> {
  if (!validateLexShardJobPayload(payload)) {
    throw new Error('invalid_lex_shard_payload');
  }

  const queue = getQueue(queueName);
  const jobId = `lex-shard__${payload.queuePhase}__${payload.shardId}`;

  interface RawRedis {
    zrem(key: string, ...members: string[]): Promise<number>;
  }
  const redis = await (queue as unknown as { client: Promise<RawRedis> }).client;
  const prefix = qmOptions.config.bullmqPrefix;
  const keyBase = `${prefix}:${queueName}`;
  await Promise.all([
    redis.zrem(`${keyBase}:completed`, jobId),
    redis.zrem(`${keyBase}:failed`, jobId),
  ]);

  return await enqueueLexJob({
    queueName,
    jobName: LEX_SHARD_PROCESS_JOB_NAME,
    jobId,
    shopId: payload.shopId,
    payload,
    ...(typeof options?.priority === 'number' ? { priority: options.priority } : {}),
  });
}

export async function enqueueLexResolveAttributesJob(
  payload: LexResolveAttributesJobPayload
): Promise<string> {
  if (!validateLexResolveAttributesJobPayload(payload)) {
    throw new Error('invalid_lex_resolve_attributes_payload');
  }

  return await enqueueLexJob({
    queueName: LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
    jobName: LEX_RESOLVE_ATTRIBUTES_JOB_NAME,
    jobId: `lex-resolve__${payload.shopId}__${payload.runId}__${payload.requestedAt}`,
    shopId: payload.shopId,
    payload,
  });
}

export async function enqueueLexComposeLocalizationsJob(
  payload: LexComposeLocalizationJobPayload
): Promise<string> {
  if (!validateLexComposeLocalizationJobPayload(payload)) {
    throw new Error('invalid_lex_compose_localizations_payload');
  }

  return await enqueueLexJob({
    queueName: LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
    jobName: LEX_COMPOSE_LOCALIZATIONS_JOB_NAME,
    jobId: `lex-compose__${payload.shopId}__${payload.runId}__${payload.entityType}__${payload.targetLang}`,
    shopId: payload.shopId,
    payload,
  });
}

export async function enqueueLexPublishJob(payload: LexPublishJobPayload): Promise<string> {
  if (!validateLexPublishJobPayload(payload)) {
    throw new Error('invalid_lex_publish_payload');
  }

  return await enqueueLexJob({
    queueName: LEX_PUBLISH_QUEUE_NAME,
    jobName: LEX_PUBLISH_JOB_NAME,
    jobId: `lex-publish__${payload.shopId}__${payload.requestedAt}`,
    shopId: payload.shopId,
    payload,
  });
}

export async function enqueueLexRetentionJob(payload: LexRetentionJobPayload): Promise<string> {
  if (!validateLexRetentionJobPayload(payload)) {
    throw new Error('invalid_lex_retention_payload');
  }

  return await enqueueLexJob({
    queueName: LEX_RETENTION_COMPACT_QUEUE_NAME,
    jobName: LEX_RETENTION_JOB_NAME,
    jobId: `lex-retention__${payload.shopId}__${payload.requestedAt}`,
    shopId: payload.shopId,
    payload,
  });
}

export async function closeLexQueues(): Promise<void> {
  for (const queue of queueCache.values()) {
    await queue.close();
  }
  queueCache.clear();
}
