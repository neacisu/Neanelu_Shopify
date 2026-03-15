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
  validateLexRetentionJobPayload,
  validateLexRunRequestedJobPayload,
  validateLexShardJobPayload,
} from '@app/types';
import { configFromEnv, createQueue, type CreateQueueManagerOptions } from '@app/queue-manager';

import { createLexJobRunRecord } from '../processors/lex/job-runs.js';

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

type LexQueueName = (typeof LEX_QUEUE_NAMES)[number];
type LexQueue = ReturnType<typeof createQueue>;

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
}): Promise<string> {
  const queue = getQueue(params.queueName);
  const normalizedShopId = params.shopId.trim();
  const job = await queue.add(params.jobName, params.payload, {
    jobId: params.jobId,
    group: { id: normalizedShopId, priority: 10 },
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

  return await enqueueLexJob({
    queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
    jobName: LEX_RUN_REQUESTED_JOB_NAME,
    jobId: `lex-run__${payload.shopId}__${payload.runId}`,
    shopId: payload.shopId,
    payload,
  });
}

export async function enqueueLexShardJob(
  queueName: LexQueueName,
  payload: LexShardJobPayload
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
  });
}

export async function enqueueLexResolveAttributesJob(
  payload: LexResolveAttributesJobPayload
): Promise<string> {
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
