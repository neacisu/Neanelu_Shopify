import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type {
  SerperHealthResponse,
  SerperSettingsResponse,
  SerperSettingsUpdateRequest,
} from '@app/types';
import { decryptAesGcm, encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';

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
        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<SerperRow>(
            `SELECT
              serper_enabled AS "serperEnabled",
              serper_daily_budget AS "serperDailyBudget",
              serper_rate_limit_per_second AS "serperRateLimitPerSecond",
              serper_cache_ttl_seconds AS "serperCacheTtlSeconds",
              serper_budget_alert_threshold AS "serperBudgetAlertThreshold",
              serper_api_key_ciphertext IS NOT NULL AS "hasApiKey"
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

          if (enabled !== undefined) {
            updates.push(`serper_enabled = $${idx++}`);
            values.push(enabled);
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
            }
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
              serper_api_key_ciphertext IS NOT NULL AS "hasApiKey"
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

  server.get(
    '/settings/serper/health',
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
        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            serperEnabled: boolean;
            serperApiKeyCiphertext: Buffer | null;
            serperApiKeyIv: Buffer | null;
            serperApiKeyTag: Buffer | null;
          }>(
            `SELECT
              serper_enabled AS "serperEnabled",
              serper_api_key_ciphertext AS "serperApiKeyCiphertext",
              serper_api_key_iv AS "serperApiKeyIv",
              serper_api_key_tag AS "serperApiKeyTag"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        if (!row?.serperEnabled) {
          const response: SerperHealthResponse = { status: 'disabled' };
          return reply.send(successEnvelope(request.id, response));
        }

        if (!row.serperApiKeyCiphertext || !row.serperApiKeyIv || !row.serperApiKeyTag) {
          const response: SerperHealthResponse = { status: 'missing_key' };
          return reply.send(successEnvelope(request.id, response));
        }

        const key = buildEncryptionKey(env);
        const apiKey = decryptAesGcm(
          row.serperApiKeyCiphertext,
          key,
          row.serperApiKeyIv,
          row.serperApiKeyTag
        );

        const startedAt = Date.now();
        const response = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey.toString('utf-8'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: 'test', num: 1 }),
        });
        const responseTimeMs = Date.now() - startedAt;

        if (!response.ok) {
          const health: SerperHealthResponse = {
            status: 'error',
            message: `API returned ${response.status}`,
            responseTimeMs,
          };
          return reply.send(successEnvelope(request.id, health));
        }

        let creditsRemaining: number | undefined;
        try {
          const data = (await response.json()) as { credits?: unknown };
          if (typeof data.credits === 'number') {
            creditsRemaining = data.credits;
          }
        } catch {
          creditsRemaining = undefined;
        }

        const health: SerperHealthResponse = {
          status: 'ok',
          responseTimeMs,
          ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
        };
        return reply.send(successEnvelope(request.id, health));
      } catch (error) {
        logger.warn({ requestId: request.id, error }, 'Serper health check failed');
        const health: SerperHealthResponse = {
          status: 'error',
          message: error instanceof Error ? error.message : 'Serper health check failed',
        };
        return reply.send(successEnvelope(request.id, health));
      }
    }
  );
};
