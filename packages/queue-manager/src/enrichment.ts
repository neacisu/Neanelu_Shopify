import { loadEnv } from '@app/config';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';

// Local type definition to avoid ESLint resolution issues with path aliases
type BulkJobTriggeredBy = 'manual' | 'scheduler' | 'webhook' | 'system';
type EnrichmentJobPayload = Readonly<{
  shopId: string;
  productIds: string[];
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}>;

import {
  buildJobTelemetryFromActiveContext,
  configFromEnv,
  createQueue,
  type QueueManagerConfig,
} from './queue-manager.js';
import { normalizeShopIdToGroupId } from './strategies/fairness/group-id.js';

export const ENRICHMENT_QUEUE_NAME = 'pim-enrichment-queue';
export const ENRICHMENT_JOB_NAME = 'pim.enrichment.request';

let cachedConfig: QueueManagerConfig | null = null;
let enrichmentQueue: ReturnType<typeof createQueue> | undefined;

function getConfig(): QueueManagerConfig {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  cachedConfig = configFromEnv(env);
  return cachedConfig;
}

function getEnrichmentQueue(): ReturnType<typeof createQueue> {
  enrichmentQueue ??= createQueue(
    { config: getConfig() },
    {
      name: ENRICHMENT_QUEUE_NAME,
    }
  );
  return enrichmentQueue;
}

export type EnrichmentQueueLoggerLike = Readonly<{
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}>;

const fallbackLogger: EnrichmentQueueLoggerLike = {
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

export async function enqueueEnrichmentJob(
  payload: EnrichmentJobPayload,
  logger?: EnrichmentQueueLoggerLike
): Promise<void> {
  const queue = getEnrichmentQueue();
  const log = logger ?? fallbackLogger;
  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error({ err, shopId: payload.shopId }, 'Refusing to enqueue enrichment job');
    throw err;
  }

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': ENRICHMENT_QUEUE_NAME,
      'queue.job.name': ENRICHMENT_JOB_NAME,
      'queue.group.id': normalizedShopId,
      'shop.id': normalizedShopId,
      'enrichment.product_count': payload.productIds.length,
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(
        ENRICHMENT_JOB_NAME,
        { ...payload, shopId: normalizedShopId },
        {
          jobId: `pim-enrichment__${normalizedShopId}__${payload.requestedAt}`,
          group: { id: normalizedShopId, priority: 10 },
          ...(telemetry ? { telemetry } : {}),
        }
      );
    });
    span.setStatus({ code: SpanStatusCode.OK });
    log.info(
      { shopId: normalizedShopId, productCount: payload.productIds.length },
      'Enrichment job enqueued'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    log.error({ err: error, shopId: normalizedShopId }, 'Failed to enqueue enrichment job');
    throw error;
  } finally {
    span.end();
  }
}

export async function closeEnrichmentQueue(): Promise<void> {
  if (enrichmentQueue) {
    await enrichmentQueue.close();
    enrichmentQueue = undefined;
  }
}
