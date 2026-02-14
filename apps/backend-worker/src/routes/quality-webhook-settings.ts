import { setTimeout as sleep } from 'node:timers/promises';

import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { QualityEventType } from '@app/types';
import { withTenantContext } from '@app/database';
import { QualityWebhookConfigUpdateSchema } from '@app/validation';
import {
  dispatchQualityWebhook,
  fetchWebhookConfig,
  generateWebhookSecret,
  getQualityEventById,
  listWebhookDeliveries,
  resetEventWebhookPending,
  upsertWebhookConfig,
} from '@app/pim';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { enqueueQualityWebhookRetryJob } from '../queue/quality-webhook-queue.js';

type QualityWebhookSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

const ALLOWED_EVENTS: QualityEventType[] = [
  'quality_promoted',
  'quality_demoted',
  'review_requested',
  'milestone_reached',
];
const retryWindowByEventId = new Map<string, number>();

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

function parseEvents(value: unknown): QualityEventType[] {
  if (!Array.isArray(value)) return [...ALLOWED_EVENTS];
  const events = value.filter((evt): evt is QualityEventType =>
    ALLOWED_EVENTS.includes(evt as never)
  );
  return events.length > 0 ? events : [...ALLOWED_EVENTS];
}

function isQualityEventType(value: unknown): value is QualityEventType {
  return typeof value === 'string' && ALLOWED_EVENTS.includes(value as QualityEventType);
}

function isValidWebhookUrl(value: string, env: AppEnv): boolean {
  try {
    const url = new URL(value);
    if (env.nodeEnv === 'production') return url.protocol === 'https:';
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function maskSecret(secret: string | null): string | null {
  if (!secret || secret.length < 4) return null;
  return `***...${secret.slice(-4)}`;
}

export const qualityWebhookSettingsRoutes: FastifyPluginCallback<
  QualityWebhookSettingsPluginOptions
> = (server: FastifyInstance, options) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/pim/webhooks/config',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      try {
        const cfg = await withTenantContext(session.shopId, async (client) => {
          return await fetchWebhookConfig(session.shopId, client);
        });
        return reply.send(
          successEnvelope(request.id, {
            url: cfg.url,
            enabled: cfg.enabled,
            subscribedEvents: cfg.subscribedEvents,
            secretMasked: maskSecret(cfg.secret),
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load quality webhook config');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load config'));
      }
    }
  );

  server.put(
    '/pim/webhooks/config',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const parsed = QualityWebhookConfigUpdateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid webhook config payload'));
      }
      const body = parsed.data;

      const url = typeof body.url === 'string' ? body.url.trim() : '';
      const enabled = body.enabled ?? false;
      const subscribedEvents = parseEvents(body.subscribedEvents);
      const regenerateSecret = body.regenerateSecret ?? false;

      if (enabled && (!url || !isValidWebhookUrl(url, env))) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid webhook URL'));
      }
      if (url && !isValidWebhookUrl(url, env)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid webhook URL'));
      }

      try {
        const existing = await withTenantContext(session.shopId, async (client) => {
          return await fetchWebhookConfig(session.shopId, client);
        });

        let secretPlainText: string | null = null;
        let finalSecret = existing.secret;

        if (regenerateSecret) {
          secretPlainText = generateWebhookSecret();
          finalSecret = secretPlainText;
        } else if (typeof body.secret === 'string' && body.secret.trim().length > 0) {
          finalSecret = body.secret.trim();
        } else if (enabled && (!finalSecret || finalSecret.length === 0)) {
          secretPlainText = generateWebhookSecret();
          finalSecret = secretPlainText;
        }

        await withTenantContext(session.shopId, async (client) => {
          await upsertWebhookConfig(
            {
              shopId: session.shopId,
              url: url || null,
              secret: finalSecret,
              enabled,
              subscribedEvents,
            },
            client
          );
        });

        return reply.send(
          successEnvelope(request.id, {
            url: url || null,
            enabled,
            subscribedEvents,
            secretMasked: maskSecret(finalSecret),
            ...(secretPlainText ? { secretPlaintext: secretPlainText } : {}),
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update quality webhook config');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update config'));
      }
    }
  );

  server.post(
    '/pim/webhooks/test',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const body = (request.body ?? {}) as { eventType?: unknown };
      const eventTypeRaw = typeof body.eventType === 'string' ? body.eventType : 'quality_promoted';
      if (!isQualityEventType(eventTypeRaw)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid event type'));
      }
      const eventType: QualityEventType = eventTypeRaw;

      try {
        const cfg = await withTenantContext(session.shopId, async (client) => {
          return await fetchWebhookConfig(session.shopId, client);
        });
        if (!cfg.url) {
          return reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Webhook URL not configured'));
        }

        const payload = {
          event_type: eventType,
          event_id: `test_${Date.now()}`,
          product_id: '00000000-0000-0000-0000-000000000000',
          sku: 'TEST-SKU',
          previous_level: 'bronze',
          new_level: 'silver',
          quality_score: 0.91,
          trigger_reason: 'manual_test',
          timestamp: new Date().toISOString(),
          shop_id: session.shopId,
        };
        const result = await dispatchQualityWebhook({
          url: cfg.url,
          payload,
          secret: cfg.secret,
          timeoutMs: env.qualityWebhookTimeoutMs,
        });

        return reply.send(
          successEnvelope(request.id, {
            ok: result.ok,
            httpStatus: result.httpStatus,
            responseTime: result.durationMs,
            error: result.error,
            payload,
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to test quality webhook');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to test webhook'));
      }
    }
  );

  server.get(
    '/pim/webhooks/deliveries',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const query = request.query as {
        limit?: string;
        offset?: string;
        eventType?: QualityEventType;
        status?: 'success' | 'failed';
      };
      const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
      const offset = Math.max(0, Number(query.offset ?? 0));
      const eventType =
        query.eventType && ALLOWED_EVENTS.includes(query.eventType) ? query.eventType : null;
      const status = query.status === 'success' || query.status === 'failed' ? query.status : null;

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          return await listWebhookDeliveries(
            {
              shopId: session.shopId,
              limit,
              offset,
              eventType,
              status,
            },
            client
          );
        });
        return reply.send(
          successEnvelope(request.id, {
            deliveries: data.items,
            totalCount: data.totalCount,
            hasMore: offset + limit < data.totalCount,
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to list quality webhook deliveries');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to list deliveries')
          );
      }
    }
  );

  server.post(
    '/pim/webhooks/deliveries/:eventId/retry',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const params = request.params as { eventId?: string };
      const eventId = params.eventId;
      if (!eventId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing eventId'));
      }

      const last = retryWindowByEventId.get(eventId) ?? 0;
      const now = Date.now();
      if (now - last < 60_000) {
        return reply
          .status(429)
          .send(
            errorEnvelope(request.id, 429, 'TOO_MANY_REQUESTS', 'Retry limited to once per minute')
          );
      }
      retryWindowByEventId.set(eventId, now);

      try {
        await withTenantContext(session.shopId, async (client) => {
          const owned = await client.query<{ id: string }>(
            `SELECT qe.id
               FROM prod_quality_events qe
               JOIN prod_channel_mappings pcm
                 ON pcm.product_id = qe.product_id
                AND pcm.shop_id = $2
                AND pcm.channel = 'shopify'
              WHERE qe.id = $1
              LIMIT 1`,
            [eventId, session.shopId]
          );
          if (!owned.rows[0]?.id) {
            throw new Error('event_not_found');
          }

          await resetEventWebhookPending(eventId, client);
          const evt = await getQualityEventById(eventId, client);
          if (!evt) {
            throw new Error('event_not_found');
          }
        });
        const jobId = await enqueueQualityWebhookRetryJob({ eventId, shopId: session.shopId });
        return reply.send(successEnvelope(request.id, { queued: true, jobId }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'retry_failed';
        if (msg === 'event_not_found') {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Event not found'));
        }
        logger.error({ requestId: request.id, error }, 'Failed to retry quality webhook');
        await sleep(0);
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to retry delivery')
          );
      }
    }
  );
};
