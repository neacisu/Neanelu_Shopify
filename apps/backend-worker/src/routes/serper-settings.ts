import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type {
  SerperHealthResponse,
  SerperSettingsResponse,
  SerperSettingsUpdateRequest,
} from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { runSerperHealthCheck, type SerperConnectionStatus } from '../services/serper-health.js';

type SerperSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type SerperRow = Readonly<{
  serperEnabled: boolean;
  serperDailyBudget: number | null;
  serperRateLimitPerSecond: number | null;
  serperCacheTtlSeconds: number | null;
  serperBudgetAlertThreshold: string | number | null;
  hasApiKey: boolean;
  serperConnectionStatus: SerperConnectionStatus | null;
  serperLastCheckedAt: string | null;
  serperLastSuccessAt: string | null;
  serperLastError: string | null;
}>;

type RequestWithSession = FastifyRequest & {
  session?: {
    shopId: string;
  };
};

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

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

const DEFAULT_DAILY_BUDGET = 1000;
const DEFAULT_RATE_LIMIT = 10;
const DEFAULT_CACHE_TTL = 86400;
const DEFAULT_ALERT_THRESHOLD = 0.8;

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadSerperUsage(shopId: string) {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{ requests: string; cost: string }>(
      `SELECT
         COALESCE(SUM(request_count), 0) as requests,
         COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'serper'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
    );
    const requests = Number(result.rows[0]?.requests ?? 0);
    const cost = Number(result.rows[0]?.cost ?? 0);
    return { requests, cost };
  });
}

function toApiResponse(row: SerperRow | undefined, usage: { requests: number; cost: number }) {
  const dailyBudget = row?.serperDailyBudget ?? DEFAULT_DAILY_BUDGET;
  const percentUsed = dailyBudget ? usage.requests / dailyBudget : 1;
  return {
    enabled: row?.serperEnabled ?? false,
    hasApiKey: row?.hasApiKey ?? false,
    dailyBudget,
    rateLimitPerSecond: row?.serperRateLimitPerSecond ?? DEFAULT_RATE_LIMIT,
    cacheTtlSeconds: row?.serperCacheTtlSeconds ?? DEFAULT_CACHE_TTL,
    budgetAlertThreshold: toNumber(row?.serperBudgetAlertThreshold) ?? DEFAULT_ALERT_THRESHOLD,
    connectionStatus: row?.serperConnectionStatus ?? 'unknown',
    lastCheckedAt: row?.serperLastCheckedAt ?? null,
    lastSuccessAt: row?.serperLastSuccessAt ?? null,
    lastError: row?.serperLastError ?? null,
    todayUsage: {
      requests: usage.requests,
      cost: usage.cost,
      percentUsed,
    },
  } satisfies SerperSettingsResponse;
}

export const serperSettingsRoutes: FastifyPluginCallback<SerperSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/serper',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      try {
        const fetchRow = async () =>
          withTenantContext(session.shopId, async (client) => {
            const result = await client.query<SerperRow>(
              `SELECT
                serper_enabled AS "serperEnabled",
                serper_daily_budget AS "serperDailyBudget",
                serper_rate_limit_per_second AS "serperRateLimitPerSecond",
                serper_cache_ttl_seconds AS "serperCacheTtlSeconds",
                serper_budget_alert_threshold AS "serperBudgetAlertThreshold",
                serper_api_key_ciphertext IS NOT NULL AS "hasApiKey",
                serper_connection_status AS "serperConnectionStatus",
                serper_last_checked_at AS "serperLastCheckedAt",
                serper_last_success_at AS "serperLastSuccessAt",
                serper_last_error AS "serperLastError"
              FROM shop_ai_credentials
              WHERE shop_id = $1`,
              [session.shopId]
            );
            return result.rows[0];
          });

        let row = await fetchRow();
        if (row?.serperEnabled && row.hasApiKey) {
          await runSerperHealthCheck({
            shopId: session.shopId,
            env,
            logger,
            allowStoredWhenDisabled: true,
            persist: true,
          });
          row = await fetchRow();
        }

        const usage = await loadSerperUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load Serper settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/serper',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = request.body as SerperSettingsUpdateRequest;
      const enabled = body?.enabled;
      const apiKeyRaw = body?.apiKey;
      const dailyBudget = body?.dailyBudget;
      const rateLimitPerSecond = body?.rateLimitPerSecond;
      const cacheTtlSeconds = body?.cacheTtlSeconds;
      const budgetAlertThreshold = body?.budgetAlertThreshold;

      if (dailyBudget !== undefined && (dailyBudget < 0 || dailyBudget > 100000)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid daily budget'));
      }

      if (
        rateLimitPerSecond !== undefined &&
        (rateLimitPerSecond < 1 || rateLimitPerSecond > 100)
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid rate limit'));
      }

      if (cacheTtlSeconds !== undefined && (cacheTtlSeconds < 0 || cacheTtlSeconds > 604800)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid cache TTL'));
      }

      if (
        budgetAlertThreshold !== undefined &&
        (budgetAlertThreshold < 0.5 || budgetAlertThreshold > 0.99)
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid alert threshold'));
      }

      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO shop_ai_credentials (shop_id)
             VALUES ($1)
             ON CONFLICT (shop_id) DO NOTHING`,
            [session.shopId]
          );

          const updates: string[] = [];
          const values: (string | boolean | number | Buffer | null)[] = [session.shopId];
          let idx = 2;

          let nextStatus: SerperConnectionStatus | null | undefined;
          if (enabled !== undefined) {
            updates.push(`serper_enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (dailyBudget !== undefined) {
            updates.push(`serper_daily_budget = $${idx++}`);
            values.push(dailyBudget);
          }

          if (rateLimitPerSecond !== undefined) {
            updates.push(`serper_rate_limit_per_second = $${idx++}`);
            values.push(rateLimitPerSecond);
          }

          if (cacheTtlSeconds !== undefined) {
            updates.push(`serper_cache_ttl_seconds = $${idx++}`);
            values.push(cacheTtlSeconds);
          }

          if (budgetAlertThreshold !== undefined) {
            updates.push(`serper_budget_alert_threshold = $${idx++}`);
            values.push(budgetAlertThreshold);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw.trim();
            if (trimmed.length === 0) {
              updates.push(`serper_api_key_ciphertext = NULL`);
              updates.push(`serper_api_key_iv = NULL`);
              updates.push(`serper_api_key_tag = NULL`);
              updates.push(`serper_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'missing_key';
            } else {
              const key = buildEncryptionKey(env);
              const encrypted = encryptAesGcm(Buffer.from(trimmed, 'utf-8'), key);
              updates.push(`serper_api_key_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`serper_api_key_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`serper_api_key_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`serper_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'pending';
            }
          }

          if (nextStatus != null) {
            updates.push(`serper_connection_status = $${idx}`);
            values.push(nextStatus);
            updates.push(`serper_last_error = NULL`);
          }

          if (updates.length > 0) {
            const sql = `UPDATE shop_ai_credentials
              SET ${updates.join(', ')}, updated_at = now()
              WHERE shop_id = $1`;
            await client.query(sql, values);
          }
        });

        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<SerperRow>(
            `SELECT
              serper_enabled AS "serperEnabled",
              serper_daily_budget AS "serperDailyBudget",
              serper_rate_limit_per_second AS "serperRateLimitPerSecond",
              serper_cache_ttl_seconds AS "serperCacheTtlSeconds",
              serper_budget_alert_threshold AS "serperBudgetAlertThreshold",
              serper_api_key_ciphertext IS NOT NULL AS "hasApiKey",
              serper_connection_status AS "serperConnectionStatus",
              serper_last_checked_at AS "serperLastCheckedAt",
              serper_last_success_at AS "serperLastSuccessAt",
              serper_last_error AS "serperLastError"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const usage = await loadSerperUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update Serper settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update settings')
          );
      }
    }
  );

  const handleHealthRequest = async (
    request: FastifyRequest,
    reply: FastifyReply,
    apiKeyOverride: string | null,
    allowStoredWhenDisabled: boolean
  ) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    try {
      const health = await runSerperHealthCheck({
        shopId: session.shopId,
        env,
        logger,
        apiKeyOverride,
        allowStoredWhenDisabled,
        persist: !apiKeyOverride,
      });
      return reply.send(successEnvelope(request.id, health));
    } catch (error) {
      logger.warn({ requestId: request.id, error }, 'Serper health check failed');
      const health: SerperHealthResponse = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Serper health check failed',
      };
      return reply.send(successEnvelope(request.id, health));
    }
  };

  server.get(
    '/settings/serper/health',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => handleHealthRequest(request, reply, null, false)
  );

  server.post(
    '/settings/serper/health',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { apiKey?: unknown; useStoredKey?: unknown };
      const override =
        typeof body.apiKey === 'string' && body.apiKey.trim().length > 0
          ? body.apiKey.trim()
          : null;
      const allowStoredWhenDisabled = body.useStoredKey === true;
      return handleHealthRequest(request, reply, override, allowStoredWhenDisabled);
    }
  );
};
