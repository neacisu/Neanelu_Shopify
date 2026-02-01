import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { pool } from '@app/database';
import { defaultQueuePolicy, QUEUE_NAMES } from '@app/queue-manager';
import { QueueConfigSchema } from '@app/validation';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { requireAdmin } from '../auth/require-admin.js';
import { createClient } from 'redis';

type QueueSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type QueueConfig = Readonly<{
  name: string;
  concurrency: number;
  maxAttempts: number;
  backoffType: 'exponential' | 'fixed';
  backoffDelayMs: number;
  dlqRetentionDays: number;
}>;

type QueueConfigResponse = Readonly<{
  queues: QueueConfig[];
  isAdmin: boolean;
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

const DEFAULT_POLICY = defaultQueuePolicy();
const DEFAULT_BACKOFF_TYPE = (() => {
  const backoff = DEFAULT_POLICY.backoff;
  if (typeof backoff === 'object' && backoff && 'type' in backoff && backoff.type === 'fixed') {
    return 'fixed';
  }
  return 'exponential';
})();
const DEFAULT_BACKOFF_DELAY_MS = (() => {
  const backoff = DEFAULT_POLICY.backoff;
  if (typeof backoff === 'number') return backoff;
  if (typeof backoff === 'object' && backoff) {
    return backoff.delay ?? 0;
  }
  return 0;
})();
const DEFAULT_DLQ_RETENTION_DAYS = (() => {
  const removeOnFail = DEFAULT_POLICY.removeOnFail;
  if (
    typeof removeOnFail === 'object' &&
    removeOnFail &&
    'age' in removeOnFail &&
    typeof removeOnFail.age === 'number'
  ) {
    return Math.max(1, Math.round(removeOnFail.age / 86400));
  }
  return 7;
})();

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

async function getRedisClient(redisUrl: string): Promise<RedisClient> {
  if (redisClient) return redisClient;
  const client = createClient({ url: redisUrl });
  await client.connect();
  redisClient = client;
  return client;
}

function normalizeQueueName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isKnownQueueName(name: string): boolean {
  return QUEUE_NAMES.includes(name as (typeof QUEUE_NAMES)[number]);
}

async function loadQueueOverrides(): Promise<Map<string, Record<string, unknown>>> {
  const result = await pool.query<{ key: string; value: Record<string, unknown> }>(
    `SELECT key, value FROM system_config WHERE key LIKE 'queue_config:%'`
  );
  const map = new Map<string, Record<string, unknown>>();
  for (const row of result.rows) {
    const name = row.key.replace('queue_config:', '');
    map.set(name, row.value ?? {});
  }
  return map;
}

export const queueSettingsRoutes: FastifyPluginCallback<QueueSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/queues',
    { preHandler: [requireSession(sessionConfig), requireAdmin()] },
    async (request, reply) => {
      try {
        const overrides = await loadQueueOverrides();
        const queues: QueueConfig[] = QUEUE_NAMES.map((name) => {
          const override = overrides.get(name) ?? {};
          const concurrency =
            typeof override['concurrency'] === 'number'
              ? override['concurrency']
              : env.maxGlobalConcurrency;
          const maxAttempts =
            typeof override['maxAttempts'] === 'number'
              ? override['maxAttempts']
              : DEFAULT_POLICY.attempts;
          const backoffType =
            override['backoffType'] === 'fixed' || override['backoffType'] === 'exponential'
              ? override['backoffType']
              : DEFAULT_BACKOFF_TYPE;
          const backoffDelayMs =
            typeof override['backoffDelayMs'] === 'number'
              ? override['backoffDelayMs']
              : DEFAULT_BACKOFF_DELAY_MS;
          const dlqRetentionDays =
            typeof override['dlqRetentionDays'] === 'number'
              ? override['dlqRetentionDays']
              : DEFAULT_DLQ_RETENTION_DAYS;

          return {
            name,
            concurrency,
            maxAttempts,
            backoffType,
            backoffDelayMs,
            dlqRetentionDays,
          };
        });

        const response: QueueConfigResponse = { queues, isAdmin: true };
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load queue settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load queues'));
      }
    }
  );

  server.put(
    '/settings/queues',
    { preHandler: [requireSession(sessionConfig), requireAdmin()] },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      const parsed = QueueConfigSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid queue payload'));
      }

      const { queueName, concurrency, maxAttempts, backoffType, backoffDelayMs, dlqRetentionDays } =
        parsed.data;
      const name = normalizeQueueName(queueName);
      if (!isKnownQueueName(name)) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      }

      try {
        const payload = {
          ...(concurrency !== undefined ? { concurrency } : {}),
          ...(maxAttempts !== undefined ? { maxAttempts } : {}),
          ...(backoffType !== undefined ? { backoffType } : {}),
          ...(backoffDelayMs !== undefined ? { backoffDelayMs } : {}),
          ...(dlqRetentionDays !== undefined ? { dlqRetentionDays } : {}),
        };

        await pool.query(
          `INSERT INTO system_config (key, value, description, is_sensitive, updated_at, created_at)
           VALUES ($1, $2::jsonb, $3, false, now(), now())
           ON CONFLICT (key)
           DO UPDATE SET
             value = EXCLUDED.value,
             description = EXCLUDED.description,
             updated_at = now()`,
          [`queue_config:${name}`, JSON.stringify(payload), `Queue config override for ${name}`]
        );

        const redis = await getRedisClient(env.redisUrl);
        await redis.publish(
          'queue_config_changed',
          JSON.stringify({ queueName: name, config: payload, timestamp: Date.now() })
        );

        return reply.send(successEnvelope(request.id, { ok: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update queue settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update queue'));
      }
    }
  );
};
