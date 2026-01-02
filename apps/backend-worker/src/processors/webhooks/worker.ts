/**
 * Webhook Worker
 *
 * CONFORM: Plan_de_implementare F3.3.5
 * - Consume webhook queue
 * - Dispatch to handlers (start with app/uninstalled)
 */

import { Worker } from 'bullmq';
import { loadEnv } from '@app/config';
import { pool, withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import type { WebhookJobPayload } from '@app/types';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';

import { WEBHOOK_QUEUE_NAME } from '../../queue/webhook-queue.js';
import { handleAppUninstalled } from './handlers/app-uninstalled.handler.js';

const env = loadEnv();

const RedisCtor = Redis as unknown as new (url: string) => RedisClient;

export interface WebhookWorkerHandle {
  worker: Worker<WebhookJobPayload>;
  redis: RedisClient;
  close: () => Promise<void>;
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
  if (!ref) {
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

  const worker = new Worker<WebhookJobPayload>(
    WEBHOOK_QUEUE_NAME,
    async (job) => {
      const payload = job.data;
      const jobId = String(job.id ?? job.name);

      const shopId = await getShopIdByDomain(payload.shopDomain);
      if (!shopId) {
        logger.warn(
          { shopDomain: payload.shopDomain, topic: payload.topic, webhookId: payload.webhookId },
          'Webhook received for unknown shop'
        );
        return;
      }

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
              { topic: payload.topic, shopDomain: payload.shopDomain },
              'No handler registered for topic (noop)'
            );
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'unknown_error';
        logger.error(
          {
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
              { err, shopDomain: payload.shopDomain, topic: payload.topic },
              'Failed to mark webhook event processed'
            );
          }
        }
      }
    },
    {
      connection: { url: env.redisUrl },
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    logger.warn(
      {
        jobId: job?.id,
        name: job?.name,
        err,
      },
      'Webhook worker job failed'
    );
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await redis.quit();
  };

  return { worker, redis, close };
}
