import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type {
  GeminiHealthResponse,
  GeminiSettingsResponse,
  GeminiSettingsUpdateRequest,
} from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { runGeminiHealthCheck } from '../services/gemini-health.js';

type GeminiSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type GeminiRow = Readonly<{
  geminiEnabled: boolean;
  geminiDailyBudget: number | null;
  geminiRateLimitPerMinute: number | null;
  geminiMaxTokensPerRequest: number | null;
  geminiTemperature: string | number | null;
  geminiBudgetAlertThreshold: string | number | null;
  geminiModel: string | null;
  hasApiKey: boolean;
  geminiConnectionStatus: GeminiSettingsResponse['connectionStatus'] | null;
  geminiLastCheckedAt: string | null;
  geminiLastSuccessAt: string | null;
  geminiLastError: string | null;
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
const DEFAULT_MODEL = 'gemini-2.5-flash';
const AVAILABLE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadGeminiUsage(shopId: string) {
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
      WHERE api_provider = 'gemini'
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
  row: GeminiRow | undefined,
  usage: { requests: number; inputTokens: number; outputTokens: number; cost: number }
) {
  const dailyBudget = row?.geminiDailyBudget ?? DEFAULT_DAILY_BUDGET;
  const percentUsed = dailyBudget ? usage.cost / dailyBudget : 1;
  return {
    enabled: row?.geminiEnabled ?? false,
    hasApiKey: row?.hasApiKey ?? false,
    model: row?.geminiModel ?? DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS,
    temperature: toNumber(row?.geminiTemperature) ?? DEFAULT_TEMPERATURE,
    maxTokensPerRequest: row?.geminiMaxTokensPerRequest ?? DEFAULT_MAX_TOKENS,
    rateLimitPerMinute: row?.geminiRateLimitPerMinute ?? DEFAULT_RATE_LIMIT,
    dailyBudget,
    budgetAlertThreshold: toNumber(row?.geminiBudgetAlertThreshold) ?? DEFAULT_ALERT_THRESHOLD,
    connectionStatus: row?.geminiConnectionStatus ?? 'unknown',
    lastCheckedAt: row?.geminiLastCheckedAt ?? null,
    lastSuccessAt: row?.geminiLastSuccessAt ?? null,
    lastError: row?.geminiLastError ?? null,
    todayUsage: {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: usage.cost,
      percentUsed,
    },
  } satisfies GeminiSettingsResponse;
}

export const geminiSettingsRoutes: FastifyPluginCallback<GeminiSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/gemini',
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
            const result = await client.query<GeminiRow>(
              `SELECT
                gemini_enabled AS "geminiEnabled",
                gemini_daily_budget AS "geminiDailyBudget",
                gemini_rate_limit_per_minute AS "geminiRateLimitPerMinute",
                gemini_max_tokens_per_request AS "geminiMaxTokensPerRequest",
                gemini_temperature AS "geminiTemperature",
                gemini_budget_alert_threshold AS "geminiBudgetAlertThreshold",
                gemini_model AS "geminiModel",
                gemini_api_key_ciphertext IS NOT NULL AS "hasApiKey",
                gemini_connection_status AS "geminiConnectionStatus",
                gemini_last_checked_at AS "geminiLastCheckedAt",
                gemini_last_success_at AS "geminiLastSuccessAt",
                gemini_last_error AS "geminiLastError"
              FROM shop_ai_credentials
              WHERE shop_id = $1`,
              [session.shopId]
            );
            return result.rows[0];
          });

        let row = await fetchRow();
        if (row?.geminiEnabled && row.hasApiKey) {
          await runGeminiHealthCheck({
            shopId: session.shopId,
            env,
            logger,
            allowStoredWhenDisabled: true,
            persist: true,
          });
          row = await fetchRow();
        }

        const usage = await loadGeminiUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load Gemini settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/gemini',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = request.body as GeminiSettingsUpdateRequest;
      const enabled = body?.enabled;
      const apiKeyRaw = body?.apiKey;
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

          let nextStatus: GeminiSettingsResponse['connectionStatus'] | null | undefined;
          if (enabled !== undefined) {
            updates.push(`gemini_enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (model !== undefined) {
            updates.push(`gemini_model = $${idx++}`);
            values.push(model);
          }

          if (temperature !== undefined) {
            updates.push(`gemini_temperature = $${idx++}`);
            values.push(temperature);
          }

          if (maxTokens !== undefined) {
            updates.push(`gemini_max_tokens_per_request = $${idx++}`);
            values.push(maxTokens);
          }

          if (rateLimit !== undefined) {
            updates.push(`gemini_rate_limit_per_minute = $${idx++}`);
            values.push(rateLimit);
          }

          if (dailyBudget !== undefined) {
            updates.push(`gemini_daily_budget = $${idx++}`);
            values.push(dailyBudget);
          }

          if (budgetAlertThreshold !== undefined) {
            updates.push(`gemini_budget_alert_threshold = $${idx++}`);
            values.push(budgetAlertThreshold);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw?.trim?.() ?? '';
            if (trimmed.length === 0) {
              updates.push(`gemini_api_key_ciphertext = NULL`);
              updates.push(`gemini_api_key_iv = NULL`);
              updates.push(`gemini_api_key_tag = NULL`);
              updates.push(`gemini_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'missing_key';
            } else {
              const key = buildEncryptionKey(env);
              const encrypted = encryptAesGcm(Buffer.from(trimmed, 'utf-8'), key);
              updates.push(`gemini_api_key_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`gemini_api_key_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`gemini_api_key_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`gemini_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'pending';
            }
          }

          if (nextStatus != null) {
            updates.push(`gemini_connection_status = $${idx}`);
            values.push(nextStatus);
            updates.push(`gemini_last_error = NULL`);
          }

          if (updates.length > 0) {
            const sql = `UPDATE shop_ai_credentials
              SET ${updates.join(', ')}, updated_at = now()
              WHERE shop_id = $1`;
            await client.query(sql, values);
          }
        });

        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<GeminiRow>(
            `SELECT
              gemini_enabled AS "geminiEnabled",
              gemini_daily_budget AS "geminiDailyBudget",
              gemini_rate_limit_per_minute AS "geminiRateLimitPerMinute",
              gemini_max_tokens_per_request AS "geminiMaxTokensPerRequest",
              gemini_temperature AS "geminiTemperature",
              gemini_budget_alert_threshold AS "geminiBudgetAlertThreshold",
              gemini_model AS "geminiModel",
              gemini_api_key_ciphertext IS NOT NULL AS "hasApiKey",
              gemini_connection_status AS "geminiConnectionStatus",
              gemini_last_checked_at AS "geminiLastCheckedAt",
              gemini_last_success_at AS "geminiLastSuccessAt",
              gemini_last_error AS "geminiLastError"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const usage = await loadGeminiUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update Gemini settings');
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
      const health = await runGeminiHealthCheck({
        shopId: session.shopId,
        env,
        logger,
        apiKeyOverride,
        allowStoredWhenDisabled,
        persist: !apiKeyOverride,
      });
      return reply.send(successEnvelope(request.id, health));
    } catch (error) {
      logger.warn({ requestId: request.id, error }, 'Gemini health check failed');
      const health: GeminiHealthResponse = {
        status: 'error',
        checkedAt: nowIso(),
        message: error instanceof Error ? error.message : 'Gemini health check failed',
      };
      return reply.send(successEnvelope(request.id, health));
    }
  };

  server.get(
    '/settings/gemini/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => handleHealthRequest(request, reply, null, false)
  );

  server.post(
    '/settings/gemini/health',
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
