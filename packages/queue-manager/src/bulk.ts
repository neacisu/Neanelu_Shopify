import { loadEnv } from '@app/config';
import type {
  BulkMutationReconcileJobPayload,
  BulkOrchestratorJobPayload,
  BulkPollerJobPayload,
} from '@app/types';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { createHash } from 'node:crypto';

import {
  buildJobTelemetryFromActiveContext,
  configFromEnv,
  createQueue,
  type QueueManagerConfig,
} from './queue-manager.js';
import { normalizeShopIdToGroupId } from './strategies/fairness/group-id.js';

export type BulkQueueLoggerLike = Readonly<{
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}>;

const fallbackLogger: BulkQueueLoggerLike = {
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

export const BULK_QUEUE_NAME = 'bulk-queue';

// Poller runs in a separate queue so the orchestrator worker cannot consume poller jobs.
// BullMQ workers process all job names in a queue; without separation, the orchestrator
// worker would "drop" poller jobs due to payload validation and mark them completed.
export const BULK_POLLER_QUEUE_NAME = 'bulk-poller-queue';

export const BULK_MUTATION_RECONCILE_QUEUE_NAME = 'bulk-mutation-reconcile-queue';

export const BULK_ORCHESTRATOR_JOB_NAME = 'bulk.orchestrator.start';
export const BULK_POLLER_JOB_NAME = 'bulk.poller';
export const BULK_MUTATION_RECONCILE_JOB_NAME = 'bulk.mutation.reconcile';

export type EnqueueBulkJobOptions = Readonly<{
  /** Delay the job by N milliseconds (BullMQ `delay`). */
  delayMs?: number;
}>;

let cachedConfig: QueueManagerConfig | null = null;
let bulkOrchestratorQueue: ReturnType<typeof createQueue> | undefined;
let bulkPollerQueue: ReturnType<typeof createQueue> | undefined;
let bulkMutationReconcileQueue: ReturnType<typeof createQueue> | undefined;

function getConfig(): QueueManagerConfig {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  cachedConfig = configFromEnv(env);
  return cachedConfig;
}

function getOrchestratorQueue(): ReturnType<typeof createQueue> {
  bulkOrchestratorQueue ??= createQueue(
    { config: getConfig() },
    {
      name: BULK_QUEUE_NAME,
    }
  );
  return bulkOrchestratorQueue;
}

function getPollerQueue(): ReturnType<typeof createQueue> {
  bulkPollerQueue ??= createQueue(
    { config: getConfig() },
    {
      name: BULK_POLLER_QUEUE_NAME,
    }
  );
  return bulkPollerQueue;
}

function getMutationReconcileQueue(): ReturnType<typeof createQueue> {
  // Keep it separate from poller/orchestrator to avoid payload validation mismatches.
  // This also allows dedicated concurrency tuning later.
  bulkMutationReconcileQueue ??= createQueue(
    { config: getConfig() },
    {
      name: BULK_MUTATION_RECONCILE_QUEUE_NAME,
    }
  );
  return bulkMutationReconcileQueue;
}

function deriveIdempotencyKey(input: {
  shopId: string;
  operationType: string;
  kind: 'query' | 'mutation';
  queryType?: string;
  queryVersion?: string;
  graphqlQuery?: string;
  mutationType?: string;
  mutationVersion?: string;
  graphqlMutation?: string;
  inputChecksum?: string;
}): string {
  const h = createHash('sha256');
  h.update(input.shopId);
  h.update('|');
  h.update(input.operationType);
  h.update('|');
  h.update(input.kind);
  h.update('|');
  if (input.kind === 'query') {
    h.update(input.queryType ?? '');
    h.update('|');
    h.update(input.queryVersion ?? '');
    h.update('|');
    h.update(input.graphqlQuery ?? '');
  } else {
    h.update(input.mutationType ?? '');
    h.update('|');
    h.update(input.mutationVersion ?? '');
    h.update('|');
    h.update(input.graphqlMutation ?? '');
    h.update('|');
    // Prefer checksum to avoid coupling idempotency to local file paths.
    h.update(input.inputChecksum ?? '');
  }
  return h.digest('hex');
}

export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  options: EnqueueBulkJobOptions
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  logger: BulkQueueLoggerLike
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  logger: BulkQueueLoggerLike,
  options: EnqueueBulkJobOptions
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  loggerOrOptions?: BulkQueueLoggerLike | EnqueueBulkJobOptions,
  maybeOptions?: EnqueueBulkJobOptions
): Promise<void> {
  const queue = getOrchestratorQueue();

  const looksLikeLogger = (value: unknown): value is BulkQueueLoggerLike => {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<Record<keyof BulkQueueLoggerLike, unknown>>;
    return (
      typeof v.info === 'function' && typeof v.warn === 'function' && typeof v.error === 'function'
    );
  };

  const log = looksLikeLogger(loggerOrOptions) ? loggerOrOptions : fallbackLogger;
  const options: EnqueueBulkJobOptions = looksLikeLogger(loggerOrOptions)
    ? (maybeOptions ?? {})
    : (loggerOrOptions ?? {});

  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId: payload.shopId }, 'Refusing to enqueue bulk orchestrator job');
    throw err;
  }

  const isMutation = 'graphqlMutation' in payload;

  const idempotencyKey = payload.idempotencyKey?.trim()
    ? payload.idempotencyKey.trim()
    : isMutation
      ? deriveIdempotencyKey({
          shopId: normalizedShopId,
          operationType: payload.operationType,
          kind: 'mutation',
          mutationType: payload.mutationType,
          graphqlMutation: payload.graphqlMutation,
          ...(payload.mutationVersion ? { mutationVersion: payload.mutationVersion } : {}),
          ...(payload.inputChecksum ? { inputChecksum: payload.inputChecksum } : {}),
        })
      : deriveIdempotencyKey({
          shopId: normalizedShopId,
          operationType: payload.operationType,
          kind: 'query',
          ...(payload.queryType ? { queryType: payload.queryType } : {}),
          ...(payload.queryVersion ? { queryVersion: payload.queryVersion } : {}),
          graphqlQuery: payload.graphqlQuery,
        });

  const normalizedPayload: BulkOrchestratorJobPayload = {
    ...payload,
    shopId: normalizedShopId,
    idempotencyKey,
  };

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': BULK_QUEUE_NAME,
      'queue.job.name': BULK_ORCHESTRATOR_JOB_NAME,
      'queue.job.id': idempotencyKey,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'bulk.operation_type': normalizedPayload.operationType,
      ...(!('graphqlMutation' in normalizedPayload) && normalizedPayload.queryType
        ? { 'bulk.query_type': normalizedPayload.queryType }
        : {}),
      ...(!('graphqlMutation' in normalizedPayload) && normalizedPayload.queryVersion
        ? { 'bulk.query_version': normalizedPayload.queryVersion }
        : {}),
      ...('graphqlMutation' in normalizedPayload
        ? {
            'bulk.mutation_type': normalizedPayload.mutationType,
            ...(normalizedPayload.mutationVersion
              ? { 'bulk.mutation_version': normalizedPayload.mutationVersion }
              : {}),
            ...(typeof normalizedPayload.chunkIndex === 'number'
              ? { 'bulk.chunk_index': normalizedPayload.chunkIndex }
              : {}),
            ...(typeof normalizedPayload.chunkCount === 'number'
              ? { 'bulk.chunk_count': normalizedPayload.chunkCount }
              : {}),
          }
        : {}),
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(BULK_ORCHESTRATOR_JOB_NAME, normalizedPayload, {
        // BullMQ restriction: custom jobId cannot contain ':'
        jobId: `bulk-orchestrator__${normalizedShopId}__${idempotencyKey}`,
        // BullMQ Pro: job-level `priority` cannot be combined with `group`.
        // Use group priority to keep fairness + priority semantics.
        group: { id: normalizedShopId, priority: 10 },
        ...(typeof options.delayMs === 'number' && Number.isFinite(options.delayMs)
          ? { delay: Math.max(0, Math.floor(options.delayMs)) }
          : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      { shopId: normalizedShopId, operationType: normalizedPayload.operationType, idempotencyKey },
      'Bulk orchestrator job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error(
      {
        err: error,
        shopId: normalizedShopId,
        operationType: normalizedPayload.operationType,
        idempotencyKey,
      },
      'Failed to enqueue bulk orchestrator job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function enqueueBulkPollerJob(payload: BulkPollerJobPayload): Promise<void>;
export async function enqueueBulkPollerJob(
  payload: BulkPollerJobPayload,
  logger: BulkQueueLoggerLike
): Promise<void>;
export async function enqueueBulkPollerJob(
  payload: BulkPollerJobPayload,
  logger?: BulkQueueLoggerLike
): Promise<void> {
  const queue = getPollerQueue();
  const log = logger ?? fallbackLogger;
  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId: payload.shopId }, 'Refusing to enqueue bulk poller job');
    throw err;
  }

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': BULK_POLLER_QUEUE_NAME,
      'queue.job.name': BULK_POLLER_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'bulk.run_id': payload.bulkRunId,
      'shopify.bulk_operation_id': payload.shopifyOperationId,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(
        BULK_POLLER_JOB_NAME,
        { ...payload, shopId: normalizedShopId },
        {
          // BullMQ restriction: custom jobId cannot contain ':'
          jobId: `bulk-poller__${payload.bulkRunId}`,
          group: { id: normalizedShopId, priority: 10 },
          ...(telemetry ? { telemetry } : {}),
        }
      );
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      {
        shopId: normalizedShopId,
        bulkRunId: payload.bulkRunId,
        shopifyOperationId: payload.shopifyOperationId,
      },
      'Bulk poller job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error(
      {
        err: error,
        shopId: normalizedShopId,
        bulkRunId: payload.bulkRunId,
        shopifyOperationId: payload.shopifyOperationId,
      },
      'Failed to enqueue bulk poller job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function enqueueBulkMutationReconcileJob(
  payload: BulkMutationReconcileJobPayload,
  logger?: BulkQueueLoggerLike
): Promise<void> {
  const queue = getMutationReconcileQueue();
  const log = logger ?? fallbackLogger;
  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId: payload.shopId }, 'Refusing to enqueue bulk mutation reconcile job');
    throw err;
  }

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': BULK_MUTATION_RECONCILE_QUEUE_NAME,
      'queue.job.name': BULK_MUTATION_RECONCILE_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'bulk.run_id': payload.bulkRunId,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(
        BULK_MUTATION_RECONCILE_JOB_NAME,
        { ...payload, shopId: normalizedShopId },
        {
          jobId: `bulk-mutation-reconcile__${payload.bulkRunId}`,
          group: { id: normalizedShopId, priority: 10 },
          ...(telemetry ? { telemetry } : {}),
        }
      );
    });

    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      { shopId: normalizedShopId, bulkRunId: payload.bulkRunId },
      'Bulk mutation reconcile job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error(
      { err: error, shopId: normalizedShopId, bulkRunId: payload.bulkRunId },
      'Failed to enqueue bulk mutation reconcile job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function closeBulkQueue(): Promise<void> {
  if (bulkOrchestratorQueue) {
    await bulkOrchestratorQueue.close();
    bulkOrchestratorQueue = undefined;
  }
  if (bulkPollerQueue) {
    await bulkPollerQueue.close();
    bulkPollerQueue = undefined;
  }
  if (bulkMutationReconcileQueue) {
    await bulkMutationReconcileQueue.close();
    bulkMutationReconcileQueue = undefined;
  }
}
