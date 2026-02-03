import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { XaiHealthResponse, XaiSettingsResponse, XaiSettingsUpdateRequest } from '@app/types';
import { decryptAesGcm, encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';

type XaiSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type XaiRow = Readonly<{
  xaiEnabled: boolean;
  xaiDailyBudget: number | null;
  xaiRateLimitPerMinute: number | null;
  xaiMaxTokensPerRequest: number | null;
  xaiTemperature: string | number | null;
  xaiBudgetAlertThreshold: string | number | null;
  xaiBaseUrl: string | null;
  xaiModel: string | null;
  hasApiKey: boolean;
  xaiConnectionStatus: XaiHealthResponse['status'] | null;
  xaiLastCheckedAt: string | null;
  xaiLastSuccessAt: string | null;
  xaiLastError: string | null;
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
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_ALERT_THRESHOLD = 0.8;
const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadXaiUsage(shopId: string) {
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
      WHERE api_provider = 'xai'
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

async function runXaiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}) {
  const { shopId, env, logger, apiKeyOverride, allowStoredWhenDisabled, persist } = params;
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      xai_enabled: boolean;
      xai_api_key_ciphertext: Buffer | null;
      xai_api_key_iv: Buffer | null;
      xai_api_key_tag: Buffer | null;
      xai_base_url: string | null;
      xai_model: string | null;
    }>(
      `SELECT xai_enabled, xai_api_key_ciphertext, xai_api_key_iv, xai_api_key_tag,
              xai_base_url, xai_model
         FROM shop_ai_credentials
        WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });

  if (!row) {
    return {
      status: 'missing_key',
      checkedAt: nowIso(),
      message: 'Missing xAI configuration',
    } as const;
  }

  if (!row.xai_enabled && !allowStoredWhenDisabled) {
    return { status: 'disabled', checkedAt: nowIso(), message: 'xAI is disabled' } as const;
  }

  if (
    !apiKeyOverride &&
    (!row.xai_api_key_ciphertext || !row.xai_api_key_iv || !row.xai_api_key_tag)
  ) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing xAI API key' } as const;
  }

  const baseUrl = row.xai_base_url ?? DEFAULT_BASE_URL;
  const model = row.xai_model ?? DEFAULT_MODEL;
  const apiKey =
    apiKeyOverride ??
    decryptAesGcm(
      row.xai_api_key_ciphertext!,
      row.xai_api_key_iv!,
      row.xai_api_key_tag!,
      buildEncryptionKey(env)
    ).toString('utf-8');
  const start = Date.now();
  let httpStatus: number | undefined;

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    httpStatus = response.status;
    const latencyMs = Date.now() - start;
    const status = response.ok ? 'connected' : 'error';
    const result: XaiHealthResponse = {
      status,
      checkedAt: nowIso(),
      latencyMs,
      httpStatus,
      baseUrl,
      model,
      message: response.ok ? 'xAI connection OK' : 'xAI connection failed',
    };

    if (persist) {
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shop_ai_credentials
              SET xai_connection_status = $1,
                  xai_last_checked_at = now(),
                  xai_last_error = $2,
                  xai_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE xai_last_success_at END
            WHERE shop_id = $3`,
          [status, response.ok ? null : `HTTP ${httpStatus}`, shopId]
        );
      });
    }

    return result;
  } catch (error) {
    logger.warn({ error }, 'xAI health check failed');
    const result: XaiHealthResponse = {
      status: 'error',
      checkedAt: nowIso(),
      latencyMs: Date.now() - start,
      baseUrl,
      model,
      message: error instanceof Error ? error.message : 'xAI connection failed',
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
    if (persist) {
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shop_ai_credentials
              SET xai_connection_status = 'error',
                  xai_last_checked_at = now(),
                  xai_last_error = $1
            WHERE shop_id = $2`,
          [result.message ?? 'unknown_error', shopId]
        );
      });
    }
    return result;
  }
}

function toApiResponse(
  row: XaiRow | undefined,
  usage: { requests: number; inputTokens: number; outputTokens: number; cost: number }
) {
  const dailyBudget = row?.xaiDailyBudget ?? DEFAULT_DAILY_BUDGET;
  const percentUsed = dailyBudget ? usage.cost / dailyBudget : 1;
  return {
    enabled: row?.xaiEnabled ?? false,
    hasApiKey: row?.hasApiKey ?? false,
    baseUrl: row?.xaiBaseUrl ?? DEFAULT_BASE_URL,
    model: row?.xaiModel ?? DEFAULT_MODEL,
    availableModels: [DEFAULT_MODEL, 'grok-4-1-fast', 'grok-3'],
    temperature: toNumber(row?.xaiTemperature) ?? DEFAULT_TEMPERATURE,
    maxTokensPerRequest: row?.xaiMaxTokensPerRequest ?? DEFAULT_MAX_TOKENS,
    rateLimitPerMinute: row?.xaiRateLimitPerMinute ?? DEFAULT_RATE_LIMIT,
    dailyBudget,
    budgetAlertThreshold: toNumber(row?.xaiBudgetAlertThreshold) ?? DEFAULT_ALERT_THRESHOLD,
    connectionStatus: row?.xaiConnectionStatus ?? 'unknown',
    lastCheckedAt: row?.xaiLastCheckedAt ?? null,
    lastSuccessAt: row?.xaiLastSuccessAt ?? null,
    lastError: row?.xaiLastError ?? null,
    todayUsage: {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: usage.cost,
      percentUsed,
    },
  } satisfies XaiSettingsResponse;
}

export const xaiSettingsRoutes: FastifyPluginCallback<XaiSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/xai',
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
            const result = await client.query<XaiRow>(
              `SELECT
                xai_enabled AS "xaiEnabled",
                xai_daily_budget AS "xaiDailyBudget",
                xai_rate_limit_per_minute AS "xaiRateLimitPerMinute",
                xai_max_tokens_per_request AS "xaiMaxTokensPerRequest",
                xai_temperature AS "xaiTemperature",
                xai_budget_alert_threshold AS "xaiBudgetAlertThreshold",
                xai_base_url AS "xaiBaseUrl",
                xai_model AS "xaiModel",
                xai_api_key_ciphertext IS NOT NULL AS "hasApiKey",
                xai_connection_status AS "xaiConnectionStatus",
                xai_last_checked_at AS "xaiLastCheckedAt",
                xai_last_success_at AS "xaiLastSuccessAt",
                xai_last_error AS "xaiLastError"
              FROM shop_ai_credentials
              WHERE shop_id = $1`,
              [session.shopId]
            );
            return result.rows[0];
          });

        let row = await fetchRow();
        if (row?.xaiEnabled && row.hasApiKey) {
          await runXaiHealthCheck({
            shopId: session.shopId,
            env,
            logger,
            allowStoredWhenDisabled: true,
            persist: true,
          });
          row = await fetchRow();
        }

        const usage = await loadXaiUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load xAI settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/xai',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = request.body as XaiSettingsUpdateRequest;
      const enabled = body?.enabled;
      const apiKeyRaw = body?.apiKey;
      const baseUrl = body?.baseUrl;
      const model = body?.model;
      const temperature = body?.temperature;
      const maxTokens = body?.maxTokensPerRequest;
      const rateLimit = body?.rateLimitPerMinute;
      const dailyBudget = body?.dailyBudget;
      const budgetAlertThreshold = body?.budgetAlertThreshold;

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

          let nextStatus: XaiHealthResponse['status'] | null = null;
          if (enabled !== undefined) {
            updates.push(`xai_enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (baseUrl !== undefined) {
            updates.push(`xai_base_url = $${idx++}`);
            values.push(baseUrl);
          }

          if (model !== undefined) {
            updates.push(`xai_model = $${idx++}`);
            values.push(model);
          }

          if (temperature !== undefined) {
            updates.push(`xai_temperature = $${idx++}`);
            values.push(temperature);
          }

          if (maxTokens !== undefined) {
            updates.push(`xai_max_tokens_per_request = $${idx++}`);
            values.push(maxTokens);
          }

          if (rateLimit !== undefined) {
            updates.push(`xai_rate_limit_per_minute = $${idx++}`);
            values.push(rateLimit);
          }

          if (dailyBudget !== undefined) {
            updates.push(`xai_daily_budget = $${idx++}`);
            values.push(dailyBudget);
          }

          if (budgetAlertThreshold !== undefined) {
            updates.push(`xai_budget_alert_threshold = $${idx++}`);
            values.push(budgetAlertThreshold);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw?.trim?.() ?? '';
            if (trimmed.length === 0) {
              updates.push(`xai_api_key_ciphertext = NULL`);
              updates.push(`xai_api_key_iv = NULL`);
              updates.push(`xai_api_key_tag = NULL`);
              updates.push(`xai_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'missing_key';
            } else {
              const key = buildEncryptionKey(env);
              const encrypted = encryptAesGcm(Buffer.from(trimmed, 'utf-8'), key);
              updates.push(`xai_api_key_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`xai_api_key_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`xai_api_key_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`xai_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'pending';
            }
          }

          if (nextStatus) {
            updates.push(`xai_connection_status = $${idx++}`);
            values.push(nextStatus);
            updates.push(`xai_last_error = NULL`);
          }

          if (updates.length > 0) {
            const sql = `UPDATE shop_ai_credentials
              SET ${updates.join(', ')}, updated_at = now()
              WHERE shop_id = $1`;
            await client.query(sql, values);
          }
        });

        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<XaiRow>(
            `SELECT
              xai_enabled AS "xaiEnabled",
              xai_daily_budget AS "xaiDailyBudget",
              xai_rate_limit_per_minute AS "xaiRateLimitPerMinute",
              xai_max_tokens_per_request AS "xaiMaxTokensPerRequest",
              xai_temperature AS "xaiTemperature",
              xai_budget_alert_threshold AS "xaiBudgetAlertThreshold",
              xai_base_url AS "xaiBaseUrl",
              xai_model AS "xaiModel",
              xai_api_key_ciphertext IS NOT NULL AS "hasApiKey",
              xai_connection_status AS "xaiConnectionStatus",
              xai_last_checked_at AS "xaiLastCheckedAt",
              xai_last_success_at AS "xaiLastSuccessAt",
              xai_last_error AS "xaiLastError"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const usage = await loadXaiUsage(session.shopId);
        const response = toApiResponse(row, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update xAI settings');
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

    const health = await runXaiHealthCheck({
      shopId: session.shopId,
      env,
      logger,
      apiKeyOverride,
      allowStoredWhenDisabled,
      persist: !apiKeyOverride,
    });
    return reply.send(successEnvelope(request.id, health));
  };

  server.get(
    '/settings/xai/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => handleHealthRequest(request, reply, null, false)
  );

  server.post(
    '/settings/xai/health',
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
