import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  buildQualityPayload,
  dispatchQualityWebhook,
  fetchWebhookConfig,
  getQualityEventById,
  logWebhookDelivery,
  markEventWebhookSent,
} from '@app/pim';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import {
  recordQualityWebhookDispatched,
  recordQualityWebhookDuration,
} from '../../otel/metrics.js';
import { QUALITY_WEBHOOK_QUEUE_NAME } from '../../queue/quality-webhook-queue.js';

export interface QualityWebhookWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

type QualityWebhookJobPayload = Readonly<{
  eventId: string;
  shopId: string;
}>;

const recordQualityWebhookDispatchedSafe = recordQualityWebhookDispatched as unknown as (
  eventType: string,
  status: 'success' | 'failed' | 'skipped'
) => void;

const recordQualityWebhookDurationSafe = recordQualityWebhookDuration as unknown as (
  eventType: string,
  durationSeconds: number
) => void;

async function createInAppNotification(
  params: { shopId: string; eventId: string; eventType: string; productId: string },
  logger: Logger
): Promise<void> {
  try {
    await withTenantContext(params.shopId, async (client) => {
      await client.query(
        `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
         VALUES ($1, 'quality_event', $2, $3::jsonb, false, now())`,
        [
          params.shopId,
          `Quality event: ${params.eventType}`,
          JSON.stringify({
            eventId: params.eventId,
            productId: params.productId,
            eventType: params.eventType,
          }),
        ]
      );
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), ...params },
      'failed to create quality event notification'
    );
  }
}

export function startQualityWebhookWorker(logger: Logger): QualityWebhookWorkerHandle {
  const env = loadEnv();
  const timeoutMsRaw: unknown = (env as Record<string, unknown>)['qualityWebhookTimeoutMs'];
  const timeoutMs =
    typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.floor(timeoutMsRaw)
      : 10_000;
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: QUALITY_WEBHOOK_QUEUE_NAME,
      workerOptions: { concurrency: 5 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const payload = job.data as QualityWebhookJobPayload | null;
          if (!payload?.eventId || !payload?.shopId) {
            throw new Error('invalid_quality_webhook_payload');
          }

          await withTenantContext(payload.shopId, async (client) => {
            const event = await getQualityEventById(payload.eventId, client);
            if (!event) {
              logger.warn({ payload }, 'quality webhook event not found, skipping');
              return;
            }

            const cfg = await fetchWebhookConfig(payload.shopId, client);
            if (!cfg.enabled || !cfg.url || cfg.url.trim().length === 0) {
              await markEventWebhookSent(payload.eventId, client);
              recordQualityWebhookDispatchedSafe(event.eventType, 'skipped');
              return;
            }
            if (!cfg.subscribedEvents.includes(event.eventType)) {
              await markEventWebhookSent(payload.eventId, client);
              recordQualityWebhookDispatchedSafe(event.eventType, 'skipped');
              return;
            }

            if (job.attemptsMade === 0) {
              await createInAppNotification(
                {
                  shopId: payload.shopId,
                  eventId: payload.eventId,
                  eventType: event.eventType,
                  productId: event.productId,
                },
                logger
              );
            }

            const dispatch = await dispatchQualityWebhook({
              url: cfg.url,
              payload: buildQualityPayload(event, payload.shopId),
              secret: cfg.secret,
              timeoutMs,
            });

            await logWebhookDelivery(
              {
                eventId: payload.eventId,
                shopId: payload.shopId,
                url: cfg.url,
                eventType: event.eventType,
                httpStatus: dispatch.httpStatus,
                durationMs: dispatch.durationMs,
                responseBody: dispatch.responseBody,
                attempt: job.attemptsMade + 1,
                errorMessage: dispatch.error,
              },
              client
            );

            recordQualityWebhookDurationSafe(event.eventType, dispatch.durationMs / 1000);

            if (dispatch.ok) {
              await markEventWebhookSent(payload.eventId, client);
              recordQualityWebhookDispatchedSafe(event.eventType, 'success');
              return;
            }

            recordQualityWebhookDispatchedSafe(event.eventType, 'failed');
            throw new Error(dispatch.error ?? 'quality_webhook_dispatch_failed');
          });
        }),
    }
  );
  return { worker, close: () => worker.close() };
}
