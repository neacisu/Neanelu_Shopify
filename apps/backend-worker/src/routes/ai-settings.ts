import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { AiHealthResponse, AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';
import { runOpenAiHealthCheck, type OpenAiConnectionStatus } from '../services/openai-health.js';

type AiSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type ShopAiRow = Readonly<{
  enabled: boolean;
  openaiBaseUrl: string | null;
  openaiEmbeddingsModel: string | null;
  hasApiKey: boolean;
  embeddingBatchSize: number | null;
  similarityThreshold: string | number | null;
  openaiConnectionStatus: OpenAiConnectionStatus | null;
  openaiLastCheckedAt: string | null;
  openaiLastSuccessAt: string | null;
  openaiLastError: string | null;
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

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

const DEFAULT_EMBEDDING_BATCH_SIZE = 100;
const DEFAULT_SIMILARITY_THRESHOLD = 0.8;
const DEFAULT_DAILY_BUDGET = 100000;

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function availableModels(env: AppEnv): string[] {
  const list = [env.openAiEmbeddingsModel, 'text-embedding-3-small', 'text-embedding-3-large'];
  return Array.from(new Set(list.filter(Boolean)));
}

async function loadOpenAiUsage(shopId: string) {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{ requests: string; inputTokens: string; cost: string }>(
      `SELECT
         COALESCE(SUM(request_count), 0) as requests,
         COALESCE(SUM(tokens_input), 0) as "inputTokens",
         COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'openai'
        AND endpoint = 'embeddings'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
    );
    return {
      requests: Number(result.rows[0]?.requests ?? 0),
      inputTokens: Number(result.rows[0]?.inputTokens ?? 0),
      cost: Number(result.rows[0]?.cost ?? 0),
    };
  });
}

function toApiResponse(
  row: ShopAiRow | undefined,
  env: AppEnv,
  usage: { requests: number; inputTokens: number; cost: number }
): AiSettingsResponse {
  if (!row) {
    const dailyBudget = env.openAiEmbeddingDailyBudget ?? DEFAULT_DAILY_BUDGET;
    const percentUsed = dailyBudget ? usage.requests / dailyBudget : 1;
    return {
      enabled: false,
      hasApiKey: false,
      openaiBaseUrl: env.openAiBaseUrl ?? null,
      openaiEmbeddingsModel: env.openAiEmbeddingsModel,
      embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
      similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
      availableModels: availableModels(env),
      connectionStatus: 'unknown',
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null,
      todayUsage: {
        requests: usage.requests,
        inputTokens: usage.inputTokens,
        estimatedCost: usage.cost,
        percentUsed,
      },
    };
  }

  const dailyBudget = env.openAiEmbeddingDailyBudget ?? DEFAULT_DAILY_BUDGET;
  const percentUsed = dailyBudget ? usage.requests / dailyBudget : 1;
  return {
    enabled: row.enabled,
    hasApiKey: row.hasApiKey,
    openaiBaseUrl: row.openaiBaseUrl ?? env.openAiBaseUrl ?? null,
    openaiEmbeddingsModel: row.openaiEmbeddingsModel ?? env.openAiEmbeddingsModel,
    embeddingBatchSize: row.embeddingBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE,
    similarityThreshold: toNumber(row.similarityThreshold) ?? DEFAULT_SIMILARITY_THRESHOLD,
    availableModels: availableModels(env),
    connectionStatus: row.openaiConnectionStatus ?? 'unknown',
    lastCheckedAt: row.openaiLastCheckedAt ?? null,
    lastSuccessAt: row.openaiLastSuccessAt ?? null,
    lastError: row.openaiLastError ?? null,
    todayUsage: {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      estimatedCost: usage.cost,
      percentUsed,
    },
  };
}

export const aiSettingsRoutes: FastifyPluginCallback<AiSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/ai',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Missing session'));
      }

      try {
        const fetchRow = async () =>
          withTenantContext(session.shopId, async (client) => {
            const result = await client.query<ShopAiRow>(
              `SELECT enabled,
                openai_base_url AS "openaiBaseUrl",
                openai_embeddings_model AS "openaiEmbeddingsModel",
                embedding_batch_size AS "embeddingBatchSize",
                similarity_threshold AS "similarityThreshold",
                openai_api_key_ciphertext IS NOT NULL AS "hasApiKey",
                openai_connection_status AS "openaiConnectionStatus",
                openai_last_checked_at AS "openaiLastCheckedAt",
                openai_last_success_at AS "openaiLastSuccessAt",
                openai_last_error AS "openaiLastError"
              FROM shop_ai_credentials
              WHERE shop_id = $1`,
              [session.shopId]
            );
            return result.rows[0];
          });

        let row = await fetchRow();
        if (row?.enabled && row.hasApiKey) {
          await runOpenAiHealthCheck({
            shopId: session.shopId,
            env,
            logger,
            allowStoredWhenDisabled: true,
            persist: true,
          });
          row = await fetchRow();
        }

        const usage = await loadOpenAiUsage(session.shopId);
        const response = toApiResponse(row, env, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load AI settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.get(
    '/settings/ai/health',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Missing session'));
      }

      try {
        const response = await runOpenAiHealthCheck({
          shopId: session.shopId,
          env,
          logger,
          allowStoredWhenDisabled: false,
          persist: true,
        });
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.warn({ requestId: request.id, error }, 'OpenAI health check failed');
        const response: AiHealthResponse = {
          status: 'error',
          checkedAt: nowIso(),
          message: error instanceof Error ? error.message : 'OpenAI health check failed',
        };
        return reply.send(successEnvelope(request.id, response));
      }
    }
  );

  server.post(
    '/settings/ai/health',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Missing session'));
      }

      const body = (request.body ?? {}) as { apiKey?: unknown; useStoredKey?: unknown };
      const override =
        typeof body.apiKey === 'string' && body.apiKey.trim().length > 0
          ? body.apiKey.trim()
          : null;
      const allowStoredWhenDisabled = body.useStoredKey === true;

      try {
        const response = await runOpenAiHealthCheck({
          shopId: session.shopId,
          env,
          logger,
          apiKeyOverride: override,
          allowStoredWhenDisabled,
          persist: !override,
        });
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.warn({ requestId: request.id, error }, 'OpenAI health check failed');
        const response: AiHealthResponse = {
          status: 'error',
          checkedAt: nowIso(),
          message: error instanceof Error ? error.message : 'OpenAI health check failed',
        };
        return reply.send(successEnvelope(request.id, response));
      }
    }
  );

  server.put(
    '/settings/ai',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Missing session'));
      }

      const body = request.body as AiSettingsUpdateRequest | undefined;
      if (!body || typeof body !== 'object') {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid payload'));
      }

      const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
      const openaiBaseUrl = normalizeOptionalString(body.openaiBaseUrl);
      const openaiEmbeddingsModel = normalizeOptionalString(body.openaiEmbeddingsModel);
      const apiKeyRaw = typeof body.apiKey === 'string' ? body.apiKey : undefined;
      const embeddingBatchSize =
        typeof body.embeddingBatchSize === 'number' ? body.embeddingBatchSize : undefined;
      const similarityThreshold =
        typeof body.similarityThreshold === 'number' ? body.similarityThreshold : undefined;

      if (embeddingBatchSize !== undefined) {
        if (
          !Number.isInteger(embeddingBatchSize) ||
          embeddingBatchSize < 10 ||
          embeddingBatchSize > 500
        ) {
          return reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid embedding batch size'));
        }
      }

      if (similarityThreshold !== undefined) {
        if (similarityThreshold < 0.7 || similarityThreshold > 0.95) {
          return reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid similarity threshold'));
        }
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
          let nextStatus: OpenAiConnectionStatus | null = null;

          if (enabled !== undefined) {
            updates.push(`enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (openaiBaseUrl !== undefined) {
            updates.push(`openai_base_url = $${idx++}`);
            values.push(openaiBaseUrl);
          }

          if (openaiEmbeddingsModel !== undefined) {
            updates.push(`openai_embeddings_model = $${idx++}`);
            values.push(openaiEmbeddingsModel);
          }

          if (embeddingBatchSize !== undefined) {
            updates.push(`embedding_batch_size = $${idx++}`);
            values.push(embeddingBatchSize);
          }

          if (similarityThreshold !== undefined) {
            updates.push(`similarity_threshold = $${idx++}`);
            values.push(similarityThreshold);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw.trim();
            if (trimmed.length === 0) {
              updates.push(`openai_api_key_ciphertext = NULL`);
              updates.push(`openai_api_key_iv = NULL`);
              updates.push(`openai_api_key_tag = NULL`);
              updates.push(`openai_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'missing_key';
            } else {
              const key = buildEncryptionKey(env);
              const encrypted = encryptAesGcm(Buffer.from(trimmed, 'utf-8'), key);
              updates.push(`openai_api_key_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`openai_api_key_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`openai_api_key_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`openai_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
              nextStatus = enabled === false ? 'disabled' : 'pending';
            }
          }

          if (nextStatus) {
            updates.push(`openai_connection_status = $${idx++}`);
            values.push(nextStatus);
            updates.push(`openai_last_error = NULL`);
          }

          if (updates.length > 0) {
            const sql = `UPDATE shop_ai_credentials
              SET ${updates.join(', ')}, updated_at = now()
              WHERE shop_id = $1`;
            await client.query(sql, values);
          }
        });

        const updated = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<ShopAiRow>(
            `SELECT enabled,
              openai_base_url AS "openaiBaseUrl",
              openai_embeddings_model AS "openaiEmbeddingsModel",
              embedding_batch_size AS "embeddingBatchSize",
              similarity_threshold AS "similarityThreshold",
              openai_api_key_ciphertext IS NOT NULL AS "hasApiKey",
              openai_connection_status AS "openaiConnectionStatus",
              openai_last_checked_at AS "openaiLastCheckedAt",
              openai_last_success_at AS "openaiLastSuccessAt",
              openai_last_error AS "openaiLastError"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const usage = await loadOpenAiUsage(session.shopId);
        const response = toApiResponse(updated, env, usage);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update AI settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update settings')
          );
      }
    }
  );
};
