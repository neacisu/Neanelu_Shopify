import { loadEnv } from '@app/config';
import type { BulkOrchestratorJobPayload, BulkPollerJobPayload } from '@app/types';
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

export const BULK_ORCHESTRATOR_JOB_NAME = 'bulk.orchestrator.start';
export const BULK_POLLER_JOB_NAME = 'bulk.poller';

let cachedConfig: QueueManagerConfig | null = null;
let bulkOrchestratorQueue: ReturnType<typeof createQueue> | undefined;
let bulkPollerQueue: ReturnType<typeof createQueue> | undefined;

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

function deriveIdempotencyKey(input: {
  shopId: string;
  operationType: string;
  queryType?: string;
  graphqlQuery: string;
}): string {
  const h = createHash('sha256');
  h.update(input.shopId);
  h.update('|');
  h.update(input.operationType);
  h.update('|');
  h.update(input.queryType ?? '');
  h.update('|');
  h.update(input.graphqlQuery);
  return h.digest('hex');
}

export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  logger: BulkQueueLoggerLike
): Promise<void>;
export async function enqueueBulkOrchestratorJob(
  payload: BulkOrchestratorJobPayload,
  logger?: BulkQueueLoggerLike
): Promise<void> {
  const queue = getOrchestratorQueue();
  const log = logger ?? fallbackLogger;

  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId: payload.shopId }, 'Refusing to enqueue bulk orchestrator job');
    throw err;
  }

  const idempotencyKey = payload.idempotencyKey?.trim()
    ? payload.idempotencyKey.trim()
    : deriveIdempotencyKey({
        shopId: normalizedShopId,
        operationType: payload.operationType,
        ...(payload.queryType ? { queryType: payload.queryType } : {}),
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
      ...(normalizedPayload.queryType ? { 'bulk.query_type': normalizedPayload.queryType } : {}),
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

export async function closeBulkQueue(): Promise<void> {
  if (bulkOrchestratorQueue) {
    await bulkOrchestratorQueue.close();
    bulkOrchestratorQueue = undefined;
  }
  if (bulkPollerQueue) {
    await bulkPollerQueue.close();
    bulkPollerQueue = undefined;
  }
}
