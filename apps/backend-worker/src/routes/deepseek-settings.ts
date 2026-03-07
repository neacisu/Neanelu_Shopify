import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type {
  DeepSeekHealthResponse,
  DeepSeekSettingsResponse,
  DeepSeekSettingsUpdateRequest,
} from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { runDeepSeekHealthCheck } from '../services/deepseek-health.js';

type DeepSeekSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type DeepSeekRow = Readonly<{
  deepseekEnabled: boolean;
  deepseekDailyBudget: number | null;
  deepseekRateLimitPerMinute: number | null;
  deepseekMaxTokensPerRequest: number | null;
  deepseekTemperature: string | number | null;
  deepseekBudgetAlertThreshold: string | number | null;
  deepseekBaseUrl: string | null;
  deepseekModel: string | null;
  hasApiKey: boolean;
  deepseekConnectionStatus: DeepSeekSettingsResponse['connectionStatus'] | null;
  deepseekLastCheckedAt: string | null;
  deepseekLastSuccessAt: string | null;
  deepseekLastError: string | null;
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
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_ALERT_THRESHOLD = 0.8;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const AVAILABLE_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadDeepSeekUsage(shopId: string) {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      requests: string;
      inputTokens: string;
      outputTokens: string;
      cost: string;
    }>(
      `SELECT
         COALESCE(SUM(request_count), 0) as requests,
         COALESCE(SUM(tokens_input), 0) as "inputTokens",
         COALESCE(SUM(tokens_output), 0) as "outputTokens",
         COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'deepseek'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
    );
    const row = result.rows[0];
    return {
      requests: Number(row?.requests ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      cost: Number(row?.cost ?? 0),
    };
  });
}

function toApiResponse(
  row: DeepSeekRow | undefined,
  usage: { requests: number; inputTokens: number; outputTokens: number; cost: number }
) {
  const dailyBudget = row?.deepseekDailyBudget ?? DEFAULT_DAILY_BUDGET;
  const percentUsed = dailyBudget ? usage.cost / dailyBudget : 1;
  return {
    enabled: row?.deepseekEnabled ?? false,
    hasApiKey: row?.hasApiKey ?? false,
    baseUrl: row?.deepseekBaseUrl ?? DEFAULT_BASE_URL,
    model: row?.deepseekModel ?? DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS,
    temperature: toNumber(row?.deepseekTemperature) ?? DEFAULT_TEMPERATURE,
    maxTokensPerRequest: row?.deepseekMaxTokensPerRequest ?? DEFAULT_MAX_TOKENS,
    rateLimitPerMinute: row?.deepseekRateLimitPerMinute ?? DEFAULT_RATE_LIMIT,
    dailyBudget,
    budgetAlertThreshold: toNumber(row?.deepseekBudgetAlertThreshold) ?? DEFAULT_ALERT_THRESHOLD,
    connectionStatus: row?.deepseekConnectionStatus ?? 'unknown',
    lastCheckedAt: row?.deepseekLastCheckedAt ?? null,
    lastSuccessAt: row?.deepseekLastSuccessAt ?? null,
    lastError: row?.deepseekLastError ?? null,
    todayUsage: {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: usage.cost,
      percentUsed,
    },
  } satisfies DeepSeekSettingsResponse;
}

export const deepseekSettingsRoutes: FastifyPluginCallback<DeepSeekSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/deepseek',
    { preHandler: [requireSession(sessionConfig)] },
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
            const result = await client.query<DeepSeekRow>(
              `SELECT
                deepseek_enabled AS "deepseekEnabled",
                deepseek_daily_budget AS "deepseekDailyBudget",
                deepseek_rate_limit_per_minute AS "deepseekRateLimitPerMinute",
                deepseek_max_tokens_per_request AS "deepseekMaxTokensPerRequest",
                deepseek_temperature AS "deepseekTemperature",
                deepseek_budget_alert_threshold AS "deepseekBudgetAlertThreshold",
                deepseek_base_url AS "deepseekBaseUrl",
                deepseek_model AS "deepseekModel",
                deepseek_api_key_ciphertext IS NOT NULL AS "hasApiKey",
                deepseek_connection_status AS "deepseekConnectionStatus",
                deepseek_last_checked_at AS "deepseekLastCheckedAt",
                deepseek_last_success_at AS "deepseekLastSuccessAt",
                deepseek_last_error AS "deepseekLastError"
              FROM shop_ai_credentials
              WHERE shop_id = $1`,
              [session.shopId]
            );
            return result.rows[0];
          });

        let row = await fetchRow();
        if (row?.deepseekEnabled && row.hasApiKey) {
          await runDeepSeekHealthCheck({
            shopId: session.shopId,
            env,
            logger,
            allowStoredWhenDisabled: true,
            persist: true,
          });
          row = await fetchRow();
        }

        const usage = await loadDeepSeekUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load DeepSeek settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/deepseek',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = request.body as DeepSeekSettingsUpdateRequest;
      const enabled = body?.enabled;
      const apiKeyRaw = body?.apiKey;
      const baseUrl = body?.baseUrl;
      const model = body?.model;
      const temperature = body?.temperature;
      const maxTokens = body?.maxTokensPerRequest;
      const rateLimit = body?.rateLimitPerMinute;
      const dailyBudget = body?.dailyBudget;
      const budgetAlertThreshold = body?.budgetAlertThreshold;

      if (temperature !== undefined && (temperature < 0 || temperature > 1)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid temperature'));
      }

      if (maxTokens !== undefined && (maxTokens < 256 || maxTokens > 8000)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid max tokens'));
      }

      if (rateLimit !== undefined && (rateLimit < 1 || rateLimit > 1000)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid rate limit'));
      }

      if (dailyBudget !== undefined && (dailyBudget < 0 || dailyBudget > 100000)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid daily budget'));
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

          let nextStatus: DeepSeekSettingsResponse['connectionStatus'] | null | undefined;
          if (enabled !== undefined) {
            updates.push(`deepseek_enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (baseUrl !== undefined) {
            updates.push(`deepseek_base_url = $${idx++}`);
            values.push(baseUrl);
          }

          if (model !== undefined) {
            updates.push(`deepseek_model = $${idx++}`);
            values.push(model);
          }

          if (temperature !== undefined) {
            updates.push(`deepseek_temperature = $${idx++}`);
            values.push(temperature);
          }

          if (maxTokens !== undefined) {
            updates.push(`deepseek_max_tokens_per_request = $${idx++}`);
            values.push(maxTokens);
          }

          if (rateLimit !== undefined) {
            updates.push(`deepseek_rate_limit_per_minute = $${idx++}`);
            values.push(rateLimit);
          }

          if (dailyBudget !== undefined) {
            updates.push(`deepseek_daily_budget = $${idx++}`);
            values.push(dailyBudget);
          }

          if (budgetAlertThreshold !== undefined) {
            updates.push(`deepseek_budget_alert_threshold = $${idx++}`);
            values.push(budgetAlertThreshold);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw?.trim?.() ?? '';
            if (trimmed.length === 0) {
              updates.push(`deepseek_api_key_ciphertext = NULL`);
              updates.push(`deepseek_api_key_iv = NULL`);
              updates.push(`deepseek_api_key_tag = NULL`);
              updates.push(`deepseek_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'missing_key';
            } else {
              const key = buildEncryptionKey(env);
              const encrypted = encryptAesGcm(Buffer.from(trimmed, 'utf-8'), key);
              updates.push(`deepseek_api_key_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`deepseek_api_key_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`deepseek_api_key_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`deepseek_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'pending';
            }
          }

          if (nextStatus != null) {
            updates.push(`deepseek_connection_status = $${idx}`);
            values.push(nextStatus);
            updates.push(`deepseek_last_error = NULL`);
          }

          if (updates.length > 0) {
            const sql = `UPDATE shop_ai_credentials
              SET ${updates.join(', ')}, updated_at = now()
              WHERE shop_id = $1`;
            await client.query(sql, values);
          }
        });

        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<DeepSeekRow>(
            `SELECT
              deepseek_enabled AS "deepseekEnabled",
              deepseek_daily_budget AS "deepseekDailyBudget",
              deepseek_rate_limit_per_minute AS "deepseekRateLimitPerMinute",
              deepseek_max_tokens_per_request AS "deepseekMaxTokensPerRequest",
              deepseek_temperature AS "deepseekTemperature",
              deepseek_budget_alert_threshold AS "deepseekBudgetAlertThreshold",
              deepseek_base_url AS "deepseekBaseUrl",
              deepseek_model AS "deepseekModel",
              deepseek_api_key_ciphertext IS NOT NULL AS "hasApiKey",
              deepseek_connection_status AS "deepseekConnectionStatus",
              deepseek_last_checked_at AS "deepseekLastCheckedAt",
              deepseek_last_success_at AS "deepseekLastSuccessAt",
              deepseek_last_error AS "deepseekLastError"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const usage = await loadDeepSeekUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update DeepSeek settings');
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
      const health = await runDeepSeekHealthCheck({
        shopId: session.shopId,
        env,
        logger,
        apiKeyOverride,
        allowStoredWhenDisabled,
        persist: !apiKeyOverride,
      });
      return reply.send(successEnvelope(request.id, health));
    } catch (error) {
      logger.warn({ requestId: request.id, error }, 'DeepSeek health check failed');
      const health: DeepSeekHealthResponse = {
        status: 'error',
        checkedAt: nowIso(),
        message: error instanceof Error ? error.message : 'DeepSeek health check failed',
      };
      return reply.send(successEnvelope(request.id, health));
    }
  };

  server.get(
    '/settings/deepseek/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => handleHealthRequest(request, reply, null, false)
  );

  server.post(
    '/settings/deepseek/health',
    { preHandler: [requireSession(sessionConfig)] },
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
