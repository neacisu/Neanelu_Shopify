import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { requireAdmin } from '../auth/require-admin.js';
import { withTokenRetry } from '../auth/token-lifecycle.js';
import { REQUIRED_TOPICS, registerWebhooks } from '../shopify/webhooks/register.js';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

type WebhookSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type WebhookRow = Readonly<{
  topic: string;
  address: string;
  format: string | null;
  apiVersion: string | null;
  createdAt: string;
}>;

type WebhookConfigResponse = Readonly<{
  webhooks: {
    topic: string;
    address: string;
    format: string;
    apiVersion: string | null;
    registeredAt: string;
  }[];
  appWebhookUrl: string;
  requiredTopics: string[];
  missingTopics: string[];
}>;

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function buildWebhookConfigResponse(rows: WebhookRow[], env: AppEnv): WebhookConfigResponse {
  const registeredTopics = new Set(rows.map((row) => row.topic));
  const missingTopics = REQUIRED_TOPICS.filter((topic) => !registeredTopics.has(topic));

  return {
    webhooks: rows.map((row) => ({
      topic: row.topic,
      address: row.address,
      format: row.format ?? 'json',
      apiVersion: row.apiVersion,
      registeredAt: row.createdAt,
    })),
    appWebhookUrl: `${env.appHost.origin}/webhooks`,
    requiredTopics: [...REQUIRED_TOPICS],
    missingTopics,
  };
}

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

async function getRedisClient(redisUrl: string): Promise<RedisClient> {
  if (redisClient) return redisClient;
  const client = createClient({ url: redisUrl });
  await client.connect();
  redisClient = client;
  return client;
}

async function waitForTestResult(
  client: RedisClient,
  testId: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; latencyMs?: number }> {
  const key = `webhook_test:${testId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await client.get(key);
    if (value?.startsWith('received:')) {
      const raw = value.slice('received:'.length);
      const latencyMs = Number(raw);
      if (Number.isFinite(latencyMs)) {
        return { ok: true, latencyMs };
      }
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false };
}

export const webhookSettingsRoutes: FastifyPluginCallback<WebhookSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/webhooks',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;

      try {
        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<WebhookRow>(
            `SELECT topic,
              address,
              format,
              api_version AS "apiVersion",
              created_at AS "createdAt"
            FROM shopify_webhooks
            WHERE shop_id = $1
            ORDER BY topic ASC`,
            [session.shopId]
          );
          return result.rows;
        });

        const response = buildWebhookConfigResponse(rows, env);

        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load webhook settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load webhook settings'
            )
          );
      }
    }
  );

  server.post(
    '/settings/webhooks/reconcile',
    { preHandler: [requireSession(sessionConfig), requireAdmin()] },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;

      try {
        const key = buildEncryptionKey(env);
        await withTokenRetry(session.shopId, key, logger, async (accessToken, shopDomain) => {
          await registerWebhooks(
            session.shopId,
            shopDomain,
            accessToken,
            env.appHost.toString(),
            logger
          );
        });

        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<WebhookRow>(
            `SELECT topic,
              address,
              format,
              api_version AS "apiVersion",
              created_at AS "createdAt"
            FROM shopify_webhooks
            WHERE shop_id = $1
            ORDER BY topic ASC`,
            [session.shopId]
          );
          return result.rows;
        });

        const response = buildWebhookConfigResponse(rows, env);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reconcile webhooks';
        const status = message.includes('reauthorization') ? 409 : 500;
        const code = status === 409 ? 'REAUTH_REQUIRED' : 'INTERNAL_SERVER_ERROR';
        logger.error({ requestId: request.id, error }, 'Failed to reconcile webhooks');
        return reply.status(status).send(errorEnvelope(request.id, status, code, message));
      }
    }
  );

  server.post(
    '/settings/webhooks/test',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const body = request.body as { topic?: unknown } | undefined;
      const topic = isNonEmptyString(body?.topic) ? body?.topic.trim() : '';

      if (!topic || !REQUIRED_TOPICS.includes(topic)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid webhook topic'));
      }

      try {
        const shop = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ shopify_domain: string }>(
            `SELECT shopify_domain FROM shops WHERE id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        if (!shop?.shopify_domain) {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Shop not found'));
        }

        const testId = randomUUID();
        const payload = {
          testId,
          sentAt: Date.now(),
          topic,
          sample: true,
        };
        const rawBody = JSON.stringify(payload);
        const signature = createHmac('sha256', env.shopifyApiSecret)
          .update(rawBody)
          .digest('base64');

        const redis = await getRedisClient(env.redisUrl);
        await redis.set(`webhook_test:${testId}`, 'pending', { EX: 10 });

        const url = `${env.appHost.origin}/webhooks/${topic}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Topic': topic,
            'X-Shopify-Shop-Domain': shop.shopify_domain,
            'X-Shopify-Webhook-Id': testId,
            'X-Shopify-Hmac-Sha256': signature,
            'X-Neanelu-Webhook-Test': 'true',
          },
          body: rawBody,
        });

        if (!response.ok) {
          return reply
            .status(502)
            .send(errorEnvelope(request.id, 502, 'BAD_GATEWAY', 'Webhook test failed to send'));
        }

        const result = await waitForTestResult(redis, testId);
        if (!result.ok) {
          return reply.send(
            successEnvelope(request.id, { success: false, testId, error: 'Webhook timeout' })
          );
        }

        return reply.send(
          successEnvelope(request.id, { success: true, testId, latencyMs: result.latencyMs })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to test webhook');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to test webhook'));
      }
    }
  );
};
