import { loadEnv } from '@app/config';
import type { WebhookJobPayload } from '@app/types';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';

import {
  buildJobTelemetryFromActiveContext,
  configFromEnv,
  createQueue,
  type QueueManagerConfig,
} from './queue-manager.js';
import { normalizeShopIdToGroupId } from './strategies/fairness/group-id.js';

export type LoggerLike = Readonly<{
  // Common denominator between Fastify/Pino and our Logger.
  // This keeps call-sites consistent and avoids strictFunctionTypes variance issues.
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}>;

const fallbackLogger: LoggerLike = {
  info: (context, message) => {
    // Avoid throwing from logging in critical enqueue path.
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

export const WEBHOOK_QUEUE_NAME = 'webhook-queue';

let cachedConfig: QueueManagerConfig | null = null;
let webhookQueue: ReturnType<typeof createQueue> | undefined;

function getConfig(): QueueManagerConfig {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  cachedConfig = configFromEnv(env);
  return cachedConfig;
}

function getQueue(): ReturnType<typeof createQueue> {
  webhookQueue ??= createQueue(
    { config: getConfig() },
    {
      name: WEBHOOK_QUEUE_NAME,
    }
  );

  return webhookQueue;
}

function priorityForWebhookTopic(topic: string): number {
  // BullMQ semantics: lower number = higher priority.
  // PR-022 (F4.2.5): critical vs normal vs bulk.
  if (topic === 'app/uninstalled') return 1;
  // All other Shopify webhooks are NORMAL priority.
  return 5;
}

// Contract (Plan_de_implementare F4.1.5): `enqueueWebhookJob(payload)`.
export async function enqueueWebhookJob(payload: WebhookJobPayload): Promise<void>;
export async function enqueueWebhookJob(
  payload: WebhookJobPayload,
  logger: LoggerLike
): Promise<void>;
export async function enqueueWebhookJob(
  payload: WebhookJobPayload,
  logger?: LoggerLike
): Promise<void> {
  const queue = getQueue();
  const log = logger ?? fallbackLogger;

  const telemetry = buildJobTelemetryFromActiveContext();

  const normalizedShopId = normalizeShopIdToGroupId(payload.shopId);
  if (!normalizedShopId) {
    const err = new Error('invalid_shop_id');
    log.error(
      {
        err,
        topic: payload.topic,
        webhookId: payload.webhookId,
        shop: payload.shopDomain,
        shopId: payload.shopId,
      },
      'Refusing to enqueue webhook job with invalid shopId'
    );
    throw err;
  }

  // Ensure job.data.shopId is canonical and matches the BullMQ Pro group id.
  const normalizedPayload =
    payload.shopId === normalizedShopId ? payload : { ...payload, shopId: normalizedShopId };

  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan('queue.enqueue', {
    attributes: {
      'queue.name': WEBHOOK_QUEUE_NAME,
      'queue.job.name': normalizedPayload.topic,
      ...(normalizedPayload.webhookId ? { 'queue.job.id': normalizedPayload.webhookId } : {}),
      'queue.group.id': normalizedShopId,
      'shop.domain': normalizedPayload.shopDomain,
      'shop.id': normalizedShopId,
      'webhook.topic': normalizedPayload.topic,
      ...(normalizedPayload.webhookId ? { 'webhook.id': normalizedPayload.webhookId } : {}),
    },
  });

  try {
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      await queue.add(normalizedPayload.topic, normalizedPayload, {
        ...(normalizedPayload.webhookId ? { jobId: normalizedPayload.webhookId } : {}),
        // BullMQ Pro: job-level `priority` cannot be combined with `group`.
        // Use group priority to keep fairness + priority semantics.
        group: { id: normalizedShopId, priority: priorityForWebhookTopic(normalizedPayload.topic) },
        ...(telemetry ? { telemetry } : {}),
      });
    });

    span.setStatus({ code: SpanStatusCode.OK });

    log.info(
      {
        topic: normalizedPayload.topic,
        webhookId: normalizedPayload.webhookId,
        shop: normalizedPayload.shopDomain,
        shopId: normalizedShopId,
      },
      'Webhook enqueued successfully'
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error('unknown_error');

    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.recordException(error);

    log.error(
      {
        err: error,
        topic: normalizedPayload.topic,
        webhookId: normalizedPayload.webhookId,
        shop: normalizedPayload.shopDomain,
        shopId: normalizedShopId,
      },
      'Failed to enqueue webhook job'
    );
    throw error;
  } finally {
    span.end();
  }
}

export async function closeWebhookQueue(): Promise<void> {
  if (!webhookQueue) return;
  await webhookQueue.close();
  webhookQueue = undefined;
}

export async function cleanupWebhookJobsForShopDomain(
  shopDomain: string,
  logger: LoggerLike
): Promise<{ removed: number }> {
  const queue = getQueue();

  const maxJobsToScan = 2000;
  const pageSize = 200;

  let removed = 0;
  let scanned = 0;

  for (const state of ['waiting', 'delayed', 'prioritized', 'paused'] as const) {
    for (let start = 0; start < maxJobsToScan; start += pageSize) {
      const end = Math.min(start + pageSize - 1, maxJobsToScan - 1);
      const jobs = await queue.getJobs([state], start, end, true);
      if (jobs.length === 0) break;

      for (const job of jobs) {
        scanned += 1;
        if (scanned > maxJobsToScan) break;

        if (job.data?.shopDomain === shopDomain) {
          try {
            await job.remove();
            removed += 1;
          } catch (err) {
            logger.warn({ err, jobId: job.id, shop: shopDomain }, 'Failed removing webhook job');
          }
        }
      }

      if (scanned > maxJobsToScan) break;
      if (jobs.length < pageSize) break;
    }
  }

  logger.info({ shop: shopDomain, removed }, 'Webhook job cleanup finished');
  return { removed };
}
