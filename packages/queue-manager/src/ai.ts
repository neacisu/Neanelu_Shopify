import { loadEnv } from '@app/config';
import {
  type AiBatchBackfillJobPayload,
  type AiBatchCleanupJobPayload,
  type AiBatchOrchestratorJobPayload,
  type AiBatchPollerJobPayload,
  validateAiBatchBackfillJobPayload,
  validateAiBatchCleanupJobPayload,
  validateAiBatchOrchestratorJobPayload,
  validateAiBatchPollerJobPayload,
} from '@app/types';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';

import {
  buildJobTelemetryFromActiveContext,
  configFromEnv,
  createQueue,
  type QueueManagerConfig,
} from './queue-manager.js';
import { normalizeShopIdToGroupId } from './strategies/fairness/group-id.js';

export type AiBatchQueueLoggerLike = Readonly<{
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}>;

const fallbackLogger: AiBatchQueueLoggerLike = {
  info: (context, message) => {
    try {
      console.info(message, context);
    } catch {
      // ignore
    }
  },
  warn: (context, message) => {
    try {
      console.warn(message, context);
    } catch {
      // ignore
    }
  },
  error: (context, message) => {
    try {
      console.error(message, context);
    } catch {
      // ignore
    }
  },
};

export const AI_BATCH_QUEUE_NAME = 'ai-batch-queue';
export const AI_BATCH_ORCHESTRATOR_JOB_NAME = 'ai.batch.orchestrate';
export const AI_BATCH_POLLER_JOB_NAME = 'ai.batch.poll';
export const AI_BATCH_CLEANUP_JOB_NAME = 'ai.batch.cleanup';
export const AI_BATCH_BACKFILL_JOB_NAME = 'ai.batch.backfill';

export type EnqueueAiBatchJobOptions = Readonly<{
  /** Delay the job by N milliseconds (BullMQ `delay`). */
  delayMs?: number;
}>;

let cachedConfig: QueueManagerConfig | null = null;
let aiBatchQueue: ReturnType<typeof createQueue> | undefined;

function getConfig(): QueueManagerConfig {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  cachedConfig = configFromEnv(env);
  return cachedConfig;
}

function getAiBatchQueue(): ReturnType<typeof createQueue> {
  aiBatchQueue ??= createQueue(
    { config: getConfig() },
    {
      name: AI_BATCH_QUEUE_NAME,
    }
  );
  return aiBatchQueue;
}

function resolveGroupIdOrThrow(shopId: string, log: AiBatchQueueLoggerLike): string {
  const normalizedShopId = normalizeShopIdToGroupId(shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId }, 'Refusing to enqueue AI batch job');
    throw err;
  }
  return normalizedShopId;
}

export async function enqueueAiBatchOrchestratorJob(
  payload: AiBatchOrchestratorJobPayload
): Promise<void>;
export async function enqueueAiBatchOrchestratorJob(
  payload: AiBatchOrchestratorJobPayload,
  logger: AiBatchQueueLoggerLike
): Promise<void>;
export async function enqueueAiBatchOrchestratorJob(
  payload: AiBatchOrchestratorJobPayload,
  options: EnqueueAiBatchJobOptions
): Promise<void>;
export async function enqueueAiBatchOrchestratorJob(
  payload: AiBatchOrchestratorJobPayload,
  loggerOrOptions?: AiBatchQueueLoggerLike | EnqueueAiBatchJobOptions,
  maybeOptions?: EnqueueAiBatchJobOptions
): Promise<void> {
  if (!validateAiBatchOrchestratorJobPayload(payload)) {
    throw new Error('invalid_ai_batch_orchestrator_payload');
  }

  const queue = getAiBatchQueue();
  const looksLikeLogger = (value: unknown): value is AiBatchQueueLoggerLike => {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<Record<keyof AiBatchQueueLoggerLike, unknown>>;
    return (
      typeof v.info === 'function' && typeof v.warn === 'function' && typeof v.error === 'function'
    );
  };

  const log = looksLikeLogger(loggerOrOptions) ? loggerOrOptions : fallbackLogger;
  const options: EnqueueAiBatchJobOptions = looksLikeLogger(loggerOrOptions)
    ? (maybeOptions ?? {})
    : (loggerOrOptions ?? {});

  const normalizedShopId = resolveGroupIdOrThrow(payload.shopId, log);
  const telemetry = buildJobTelemetryFromActiveContext();

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': AI_BATCH_QUEUE_NAME,
      'queue.job.name': AI_BATCH_ORCHESTRATOR_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'ai.batch_type': payload.batchType,
      'ai.embedding_type': payload.embeddingType,
      'ai.model': payload.model,
      'ai.dimensions': payload.dimensions,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(AI_BATCH_ORCHESTRATOR_JOB_NAME, payload, {
        jobId: `ai-batch-orchestrate__${normalizedShopId}__${payload.batchType}`,
        group: { id: normalizedShopId, priority: 10 },
        ...(typeof options.delayMs === 'number' && Number.isFinite(options.delayMs)
          ? { delay: Math.max(0, Math.floor(options.delayMs)) }
          : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      { shopId: normalizedShopId, batchType: payload.batchType, model: payload.model },
      'AI batch orchestrator job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error(
      { err: error, shopId: normalizedShopId, batchType: payload.batchType },
      'Failed to enqueue AI batch orchestrator job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function enqueueAiBatchPollerJob(payload: AiBatchPollerJobPayload): Promise<void>;
export async function enqueueAiBatchPollerJob(
  payload: AiBatchPollerJobPayload,
  logger: AiBatchQueueLoggerLike
): Promise<void>;
export async function enqueueAiBatchPollerJob(
  payload: AiBatchPollerJobPayload,
  options: EnqueueAiBatchJobOptions
): Promise<void>;
export async function enqueueAiBatchPollerJob(
  payload: AiBatchPollerJobPayload,
  loggerOrOptions?: AiBatchQueueLoggerLike | EnqueueAiBatchJobOptions,
  maybeOptions?: EnqueueAiBatchJobOptions
): Promise<void> {
  if (!validateAiBatchPollerJobPayload(payload)) {
    throw new Error('invalid_ai_batch_poller_payload');
  }

  const queue = getAiBatchQueue();
  const log =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? loggerOrOptions
      : fallbackLogger;
  const options: EnqueueAiBatchJobOptions =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? (maybeOptions ?? {})
      : (loggerOrOptions ?? {});

  const normalizedShopId = resolveGroupIdOrThrow(payload.shopId, log);
  const telemetry = buildJobTelemetryFromActiveContext();

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': AI_BATCH_QUEUE_NAME,
      'queue.job.name': AI_BATCH_POLLER_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'ai.embedding_batch_id': payload.embeddingBatchId,
      'ai.openai_batch_id': payload.openAiBatchId,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(AI_BATCH_POLLER_JOB_NAME, payload, {
        jobId: `ai-batch-poll__${normalizedShopId}__${payload.embeddingBatchId}`,
        group: { id: normalizedShopId, priority: 10 },
        ...(typeof options.delayMs === 'number' && Number.isFinite(options.delayMs)
          ? { delay: Math.max(0, Math.floor(options.delayMs)) }
          : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      { shopId: normalizedShopId, embeddingBatchId: payload.embeddingBatchId },
      'AI batch poller job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error(
      { err: error, shopId: normalizedShopId, embeddingBatchId: payload.embeddingBatchId },
      'Failed to enqueue AI batch poller job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function enqueueAiBatchCleanupJob(payload: AiBatchCleanupJobPayload): Promise<void>;
export async function enqueueAiBatchCleanupJob(
  payload: AiBatchCleanupJobPayload,
  logger: AiBatchQueueLoggerLike
): Promise<void>;
export async function enqueueAiBatchCleanupJob(
  payload: AiBatchCleanupJobPayload,
  options: EnqueueAiBatchJobOptions
): Promise<void>;
export async function enqueueAiBatchCleanupJob(
  payload: AiBatchCleanupJobPayload,
  loggerOrOptions?: AiBatchQueueLoggerLike | EnqueueAiBatchJobOptions,
  maybeOptions?: EnqueueAiBatchJobOptions
): Promise<void> {
  if (!validateAiBatchCleanupJobPayload(payload)) {
    throw new Error('invalid_ai_batch_cleanup_payload');
  }

  const queue = getAiBatchQueue();
  const log =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? loggerOrOptions
      : fallbackLogger;
  const options: EnqueueAiBatchJobOptions =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? (maybeOptions ?? {})
      : (loggerOrOptions ?? {});

  const normalizedShopId = resolveGroupIdOrThrow(payload.shopId, log);
  const telemetry = buildJobTelemetryFromActiveContext();

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': AI_BATCH_QUEUE_NAME,
      'queue.job.name': AI_BATCH_CLEANUP_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(AI_BATCH_CLEANUP_JOB_NAME, payload, {
        jobId: `ai-batch-cleanup__${normalizedShopId}`,
        group: { id: normalizedShopId, priority: 5 },
        ...(typeof options.delayMs === 'number' && Number.isFinite(options.delayMs)
          ? { delay: Math.max(0, Math.floor(options.delayMs)) }
          : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info({ shopId: normalizedShopId }, 'AI batch cleanup job enqueued');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error({ err: error, shopId: normalizedShopId }, 'Failed to enqueue AI batch cleanup job');
    throw error;
  } finally {
    span.end();
  }
}

export async function enqueueAiBatchBackfillJob(payload: AiBatchBackfillJobPayload): Promise<void>;
export async function enqueueAiBatchBackfillJob(
  payload: AiBatchBackfillJobPayload,
  logger: AiBatchQueueLoggerLike
): Promise<void>;
export async function enqueueAiBatchBackfillJob(
  payload: AiBatchBackfillJobPayload,
  options: EnqueueAiBatchJobOptions
): Promise<void>;
export async function enqueueAiBatchBackfillJob(
  payload: AiBatchBackfillJobPayload,
  loggerOrOptions?: AiBatchQueueLoggerLike | EnqueueAiBatchJobOptions,
  maybeOptions?: EnqueueAiBatchJobOptions
): Promise<void> {
  if (!validateAiBatchBackfillJobPayload(payload)) {
    throw new Error('invalid_ai_batch_backfill_payload');
  }

  const queue = getAiBatchQueue();
  const log =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? loggerOrOptions
      : fallbackLogger;
  const options: EnqueueAiBatchJobOptions =
    loggerOrOptions && typeof loggerOrOptions === 'object' && 'info' in loggerOrOptions
      ? (maybeOptions ?? {})
      : (loggerOrOptions ?? {});

  const normalizedShopId = resolveGroupIdOrThrow(payload.shopId, log);
  const telemetry = buildJobTelemetryFromActiveContext();

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': AI_BATCH_QUEUE_NAME,
      'queue.job.name': AI_BATCH_BACKFILL_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'ai.backfill.chunk_size': payload.chunkSize ?? 0,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(AI_BATCH_BACKFILL_JOB_NAME, payload, {
        jobId: `ai-batch-backfill__${normalizedShopId}`,
        group: { id: normalizedShopId, priority: 5 },
        ...(typeof options.delayMs === 'number' && Number.isFinite(options.delayMs)
          ? { delay: Math.max(0, Math.floor(options.delayMs)) }
          : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info({ shopId: normalizedShopId }, 'AI batch backfill job enqueued');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error({ err: error, shopId: normalizedShopId }, 'Failed to enqueue AI backfill job');
    throw error;
  } finally {
    span.end();
  }
}

export function __testing_resolveGroupId(shopId: string): string | null {
  return normalizeShopIdToGroupId(shopId);
}
