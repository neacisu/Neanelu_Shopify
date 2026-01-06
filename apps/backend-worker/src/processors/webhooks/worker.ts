/**
 * Webhook Worker
 *
 * CONFORM: Plan_de_implementare F3.3.5
 * - Consume webhook queue
 * - Dispatch to handlers (start with app/uninstalled)
 */

import { loadEnv } from '@app/config';
import { pool, withTenantContext } from '@app/database';
import { OTEL_ATTR, withSpan, type Logger } from '@app/logger';
import { validateWebhookJobPayload, type WebhookJobPayload } from '@app/types';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import {
  configFromEnv,
  createQueue,
  createQueueEvents,
  createWorker,
  exp4BackoffMs,
  NEANELU_BACKOFF_STRATEGY,
  withJobTelemetryContext,
  WEBHOOK_QUEUE_NAME,
} from '@app/queue-manager';
import { emitQueueStreamEvent } from '../../runtime/queue-stream.js';
import {
  queueActive,
  queueDepth,
  queueJobDurationSeconds,
  queueJobBackoffSeconds,
  queueJobFailedTotal,
  queueJobLatencySeconds,
  queueJobRetriesTotal,
  queueJobStalledTotal,
  queueFairnessGroupDelayedTotal,
  queueFairnessGroupWaitSeconds,
} from '../../otel/metrics.js';
import { handleAppUninstalled } from './handlers/app-uninstalled.handler.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';

const env = loadEnv();

const RedisCtor = Redis as unknown as new (url: string) => RedisClient;

export interface WebhookWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  redis: RedisClient;
  queueEvents: { close: () => Promise<void> };
  close: () => Promise<void>;
}

async function closeWithTimeout(label: string, fn: () => Promise<void>, timeoutMs: number) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs).unref();
  });
  await Promise.race([fn(), timeout]);
}

async function getShopIdByDomain(shopDomain: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM shops WHERE shopify_domain = $1 LIMIT 1',
    [shopDomain]
  );
  return result.rows[0]?.id ?? null;
}

async function insertWebhookEvent(
  shopId: string,
  payload: WebhookJobPayload,
  payloadJson: unknown,
  jobId: string
): Promise<{ id: string } | null> {
  return withTenantContext(shopId, async (client) => {
    const receivedAt = payload.receivedAt ? new Date(payload.receivedAt) : new Date();
    const result = await client.query<{ id: string }>(
      `INSERT INTO webhook_events (
         shop_id,
         topic,
         shopify_webhook_id,
         payload,
         hmac_verified,
         received_at,
         job_id,
         idempotency_key
       )
       VALUES ($1, $2, $3, $4::jsonb, true, $5, $6, $7)
       RETURNING id`,
      [
        shopId,
        payload.topic,
        payload.webhookId ?? null,
        JSON.stringify(payloadJson),
        receivedAt,
        jobId,
        payload.webhookId ?? null,
      ]
    );

    return result.rows[0] ?? null;
  });
}

async function markWebhookEventProcessed(
  shopId: string,
  event: { id: string },
  errorMessage: string | null
): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    const result = await client.query(
      `UPDATE webhook_events
       SET processed_at = now(),
           processing_error = $1::text,
           retry_count = CASE WHEN $1::text IS NULL THEN retry_count ELSE retry_count + 1 END
       WHERE id = $2`,
      [errorMessage, event.id]
    );

    if (result.rowCount === 0) {
      throw new Error('webhook_event_update_missed_row');
    }
  });
}

async function loadPayloadFromRedis(
  redis: RedisClient,
  payload: WebhookJobPayload
): Promise<unknown> {
  const ref = payload.payloadRef;
  if (typeof ref !== 'string' || !ref) {
    throw new Error('payload_ref_missing');
  }

  const raw = await redis.get(ref);
  if (!raw) {
    throw new Error('payload_ref_not_found');
  }

  if (payload.payloadSha256) {
    const computed = createHash('sha256').update(raw, 'utf8').digest('hex');
    if (computed !== payload.payloadSha256) {
      throw new Error('payload_sha256_mismatch');
    }
  }

  return JSON.parse(raw) as unknown;
}

export function startWebhookWorker(logger: Logger): WebhookWorkerHandle {
  const redis = new RedisCtor(env.redisUrl);
  const qmOptions = { config: configFromEnv(env) };

  const queue = createQueue(qmOptions, { name: WEBHOOK_QUEUE_NAME });
  const activeStartedAtMs = new Map<string, number>();

  let lastWaitingCount: number | null = null;
  let lastActiveCount: number | null = null;
  const pollDepth = async (): Promise<void> => {
    try {
      const counts = (await queue.getJobCounts()) as Record<string, number>;
      const waiting = counts['waiting'] ?? counts['wait'] ?? 0;
      const active = counts['active'] ?? 0;

      if (lastWaitingCount === null) {
        queueDepth.add(waiting, { queue_name: WEBHOOK_QUEUE_NAME });
      } else {
        queueDepth.add(waiting - lastWaitingCount, { queue_name: WEBHOOK_QUEUE_NAME });
      }
      lastWaitingCount = waiting;

      if (lastActiveCount === null) {
        queueActive.add(active, { queue_name: WEBHOOK_QUEUE_NAME });
      } else {
        queueActive.add(active - lastActiveCount, { queue_name: WEBHOOK_QUEUE_NAME });
      }
      lastActiveCount = active;
    } catch {
      // best-effort
    }
  };

  const depthInterval = setInterval(() => {
    void pollDepth();
  }, 10_000);
  depthInterval.unref?.();

  const { worker } = createWorker<WebhookJobPayload>(qmOptions, {
    name: WEBHOOK_QUEUE_NAME,
    enableDlq: true,
    onDlqEntry: (entry) => {
      logger.error(
        {
          originalQueue: entry.originalQueue,
          originalJobId: entry.originalJobId,
          attemptsMade: entry.attemptsMade,
          failedReason: entry.failedReason,
        },
        'Webhook job moved to DLQ'
      );
    },
    processor: async (job) => {
      const jobId = String(job.id ?? job.name);

      const baseAttrs: Record<string, string | number | boolean> = {
        [OTEL_ATTR.QUEUE_NAME]: WEBHOOK_QUEUE_NAME,
        [OTEL_ATTR.QUEUE_JOB_ID]: jobId,
        [OTEL_ATTR.QUEUE_JOB_NAME]: String(job.name),
      };

      return withSpan('queue.process', baseAttrs, async (span) => {
        const payloadUnknown: unknown = job.data;
        if (!validateWebhookJobPayload(payloadUnknown)) {
          logger.warn(
            { event: 'job.drop', jobId: job.id, name: job.name, queueName: WEBHOOK_QUEUE_NAME },
            'Webhook job payload failed validation (dropping)'
          );
          return;
        }

        const payload = payloadUnknown;

        if (payload.topic) span.setAttribute(OTEL_ATTR.WEBHOOK_TOPIC, payload.topic);
        if (payload.webhookId) span.setAttribute(OTEL_ATTR.WEBHOOK_ID, payload.webhookId);
        if (payload.shopDomain) span.setAttribute(OTEL_ATTR.SHOP_DOMAIN, payload.shopDomain);
        if (payload.shopId) {
          span.setAttribute(OTEL_ATTR.SHOP_ID, payload.shopId);
          span.setAttribute(OTEL_ATTR.QUEUE_GROUP_ID, payload.shopId);
        }

        const shopId = payload.shopId || (await getShopIdByDomain(payload.shopDomain));
        if (!shopId) {
          logger.warn(
            {
              event: 'job.drop',
              queueName: WEBHOOK_QUEUE_NAME,
              jobId,
              shopDomain: payload.shopDomain,
              topic: payload.topic,
              webhookId: payload.webhookId,
            },
            'Webhook received for unknown shop'
          );
          return;
        }

        span.setAttribute(OTEL_ATTR.SHOP_ID, shopId);

        let eventRow: { id: string } | null = null;
        let errorMessage: string | null = null;

        try {
          const payloadJson = await loadPayloadFromRedis(redis, payload);
          eventRow = await insertWebhookEvent(shopId, payload, payloadJson, jobId);

          switch (payload.topic) {
            case 'app/uninstalled':
              await handleAppUninstalled({ shopId, shopDomain: payload.shopDomain }, logger);
              break;
            default:
              logger.info(
                {
                  event: 'job.no_handler',
                  queueName: WEBHOOK_QUEUE_NAME,
                  jobId,
                  topic: payload.topic,
                  shopDomain: payload.shopDomain,
                },
                'No handler registered for topic (noop)'
              );
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : 'unknown_error';
          logger.error(
            {
              event: 'job.fail',
              queueName: WEBHOOK_QUEUE_NAME,
              jobId,
              err,
              topic: payload.topic,
              shopDomain: payload.shopDomain,
              webhookId: payload.webhookId,
            },
            'Webhook job processing failed'
          );
          throw err;
        } finally {
          if (eventRow) {
            try {
              await markWebhookEventProcessed(shopId, eventRow, errorMessage);
            } catch (err) {
              logger.error(
                {
                  event: 'job.mark_processed_failed',
                  queueName: WEBHOOK_QUEUE_NAME,
                  jobId,
                  err,
                  shopDomain: payload.shopDomain,
                  topic: payload.topic,
                },
                'Failed to mark webhook event processed'
              );
            }
          }
        }
      });
    },
    workerOptions: {
      concurrency: env.maxGlobalConcurrency,
      group: {
        concurrency: env.maxActivePerShop,
      },
    },
  });

  function computeBackoffMsForRetry(job: unknown): number | null {
    const j = job as
      | {
          attemptsMade?: number;
          opts?: { backoff?: unknown };
        }
      | undefined;

    const attemptsMade = typeof j?.attemptsMade === 'number' ? j.attemptsMade : null;
    if (!attemptsMade || attemptsMade <= 0) return null;

    const configured = j?.opts?.backoff;
    const type =
      typeof configured === 'object' && configured
        ? ((configured as Record<string, unknown>)['type'] as string | undefined)
        : undefined;

    const baseDelay =
      typeof configured === 'number'
        ? configured
        : typeof configured === 'object' && configured
          ? Number((configured as Record<string, unknown>)['delay'] ?? 0) || 0
          : 0;

    if (type === NEANELU_BACKOFF_STRATEGY) return exp4BackoffMs(attemptsMade);
    if (type === 'exponential') return baseDelay * 2 ** Math.max(0, attemptsMade - 1);
    return baseDelay;
  }

  worker.on('failed', (job, err) => {
    void withJobTelemetryContext(job, async () => {
      const jobId = job?.id != null ? String(job.id) : undefined;

      if (jobId) {
        clearWorkerCurrentJob('webhook-worker', jobId);
      }
      const maxAttempts = job?.opts.attempts;
      const attemptsMade = job?.attemptsMade;
      const exhausted =
        typeof maxAttempts === 'number' &&
        typeof attemptsMade === 'number' &&
        attemptsMade >= maxAttempts;

      if (jobId) {
        const startedAt = activeStartedAtMs.get(jobId);
        if (startedAt != null) {
          queueJobDurationSeconds.record((Date.now() - startedAt) / 1000, {
            queue_name: WEBHOOK_QUEUE_NAME,
          });
          activeStartedAtMs.delete(jobId);
        }
      }

      const spanName = exhausted ? 'queue.fail' : 'queue.retry';
      const backoffMs = exhausted ? null : computeBackoffMsForRetry(job);

      await withSpan(
        spanName,
        {
          [OTEL_ATTR.QUEUE_NAME]: WEBHOOK_QUEUE_NAME,
          ...(jobId ? { [OTEL_ATTR.QUEUE_JOB_ID]: jobId } : {}),
          ...(job?.name ? { [OTEL_ATTR.QUEUE_JOB_NAME]: String(job.name) } : {}),
          ...(typeof attemptsMade === 'number'
            ? { [OTEL_ATTR.QUEUE_ATTEMPTS_MADE]: attemptsMade }
            : {}),
          ...(typeof maxAttempts === 'number'
            ? { [OTEL_ATTR.QUEUE_MAX_ATTEMPTS]: maxAttempts }
            : {}),
          ...(typeof backoffMs === 'number' ? { [OTEL_ATTR.QUEUE_BACKOFF_MS]: backoffMs } : {}),
        },
        () => Promise.resolve()
      );

      if (exhausted) {
        queueJobFailedTotal.add(1, { queue_name: WEBHOOK_QUEUE_NAME });
      } else {
        queueJobRetriesTotal.add(1, { queue_name: WEBHOOK_QUEUE_NAME });
        if (typeof backoffMs === 'number' && Number.isFinite(backoffMs) && backoffMs > 0) {
          queueJobBackoffSeconds.record(backoffMs / 1000, { queue_name: WEBHOOK_QUEUE_NAME });
        }
      }

      logger.warn(
        {
          event: exhausted ? 'job.fail' : 'job.retry',
          queueName: WEBHOOK_QUEUE_NAME,
          jobId: job?.id,
          name: job?.name,
          attemptsMade,
          maxAttempts,
          backoffMs,
          err,
        },
        exhausted ? 'Webhook worker job failed (terminal)' : 'Webhook worker job failed (retrying)'
      );

      if (jobId) {
        emitQueueStreamEvent({
          type: 'job.failed',
          queueName: WEBHOOK_QUEUE_NAME,
          jobId,
          jobName: String(job?.name ?? 'unknown'),
          attemptsMade: typeof attemptsMade === 'number' ? attemptsMade : null,
          maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : null,
          exhausted,
          errorMessage: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  worker.on('active', (job) => {
    if (!job) return;
    void withJobTelemetryContext(job, async () => {
      const jobId = String(job.id ?? job.name);
      activeStartedAtMs.set(jobId, Date.now());

      const progressUnknown = (job as unknown as { progress?: unknown }).progress;
      const progressPct =
        typeof progressUnknown === 'number' && Number.isFinite(progressUnknown)
          ? Math.max(0, Math.min(100, progressUnknown))
          : null;
      setWorkerCurrentJob('webhook-worker', {
        jobId,
        jobName: String(job.name),
        startedAtIso: new Date().toISOString(),
        progressPct,
      });

      const timestamp = (job as unknown as { timestamp?: number }).timestamp;
      const latencySeconds =
        typeof timestamp === 'number' && timestamp > 0 ? (Date.now() - timestamp) / 1000 : null;
      if (typeof latencySeconds === 'number' && Number.isFinite(latencySeconds)) {
        queueJobLatencySeconds.record(latencySeconds, {
          queue_name: WEBHOOK_QUEUE_NAME,
        });

        const group = (job.opts as unknown as { group?: unknown } | undefined)?.group;
        const isGrouped = Boolean(group && typeof group === 'object');
        if (isGrouped) {
          queueFairnessGroupWaitSeconds.record(latencySeconds, { queue_name: WEBHOOK_QUEUE_NAME });
          if (latencySeconds > 1) {
            queueFairnessGroupDelayedTotal.add(1, { queue_name: WEBHOOK_QUEUE_NAME });
          }
        }
      }

      await withSpan(
        'queue.dequeue',
        {
          [OTEL_ATTR.QUEUE_NAME]: WEBHOOK_QUEUE_NAME,
          [OTEL_ATTR.QUEUE_JOB_ID]: jobId,
          [OTEL_ATTR.QUEUE_JOB_NAME]: String(job.name),
          ...(typeof latencySeconds === 'number'
            ? { 'queue.job.latency_seconds': latencySeconds }
            : {}),
        },
        () => Promise.resolve()
      );

      logger.info(
        {
          event: 'job.start',
          queueName: WEBHOOK_QUEUE_NAME,
          jobId: job.id,
          name: job.name,
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts,
        },
        'Webhook worker job started'
      );

      emitQueueStreamEvent({
        type: 'job.started',
        queueName: WEBHOOK_QUEUE_NAME,
        jobId,
        jobName: String(job.name),
        attemptsMade: typeof job.attemptsMade === 'number' ? job.attemptsMade : null,
        maxAttempts: typeof job.opts.attempts === 'number' ? job.opts.attempts : null,
        timestamp: new Date().toISOString(),
      });
    });
  });

  worker.on('completed', (job) => {
    if (!job) return;
    void withJobTelemetryContext(job, () => {
      const jobId = String(job.id ?? job.name);

      clearWorkerCurrentJob('webhook-worker', jobId);

      const startedAt = activeStartedAtMs.get(jobId);
      const durationMs = startedAt != null ? Date.now() - startedAt : null;
      if (durationMs != null) {
        queueJobDurationSeconds.record(durationMs / 1000, { queue_name: WEBHOOK_QUEUE_NAME });
        activeStartedAtMs.delete(jobId);
      }

      logger.info(
        {
          event: 'job.complete',
          queueName: WEBHOOK_QUEUE_NAME,
          jobId: job.id,
          name: job.name,
          durationMs,
        },
        'Webhook worker job completed'
      );

      emitQueueStreamEvent({
        type: 'job.completed',
        queueName: WEBHOOK_QUEUE_NAME,
        jobId,
        jobName: String(job.name),
        durationMs,
        timestamp: new Date().toISOString(),
      });

      return Promise.resolve();
    });
  });

  const queueEvents = createQueueEvents(qmOptions, {
    name: WEBHOOK_QUEUE_NAME,
  });

  // Best-effort monitoring hooks; no business logic here.
  queueEvents.on('stalled', ({ jobId }) => {
    queueJobStalledTotal.add(1, { queue_name: WEBHOOK_QUEUE_NAME });
    logger.warn(
      { event: 'job.stalled', queueName: WEBHOOK_QUEUE_NAME, jobId },
      'Webhook job stalled'
    );
  });
  queueEvents.on('failed', ({ jobId, failedReason, prev }) => {
    logger.warn({ jobId, failedReason, prev }, 'Webhook job failed (queue event)');
  });

  const close = async (): Promise<void> => {
    await closeWithTimeout(
      'webhook worker shutdown',
      async () => {
        clearInterval(depthInterval);
        const pause = (
          worker as unknown as { pause?: (doNotWaitActive?: boolean) => Promise<void> }
        ).pause;
        if (typeof pause === 'function') {
          await pause.call(worker, false).catch(() => {
            // best-effort
          });
        }

        await worker.close();
        await queueEvents.close();
        await queue.close();
        await redis.quit();
      },
      15_000
    );
  };

  return { worker, redis, queueEvents, close };
}
