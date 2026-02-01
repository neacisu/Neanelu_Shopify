import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';

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

function toApiResponse(row: ShopAiRow | undefined, env: AppEnv): AiSettingsResponse {
  if (!row) {
    return {
      enabled: false,
      hasApiKey: false,
      openaiBaseUrl: env.openAiBaseUrl ?? null,
      openaiEmbeddingsModel: env.openAiEmbeddingsModel,
    };
  }

  return {
    enabled: row.enabled,
    hasApiKey: row.hasApiKey,
    openaiBaseUrl: row.openaiBaseUrl ?? env.openAiBaseUrl ?? null,
    openaiEmbeddingsModel: row.openaiEmbeddingsModel ?? env.openAiEmbeddingsModel,
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
        const row = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<ShopAiRow>(
            `SELECT enabled,
              openai_base_url AS "openaiBaseUrl",
              openai_embeddings_model AS "openaiEmbeddingsModel",
              openai_api_key_ciphertext IS NOT NULL AS "hasApiKey"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const response = toApiResponse(row, env);
        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load AI settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
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
            updates.push(`enabled = $${idx++}`);
            values.push(enabled);
          }

          if (openaiBaseUrl !== undefined) {
            updates.push(`openai_base_url = $${idx++}`);
            values.push(openaiBaseUrl);
          }

          if (openaiEmbeddingsModel !== undefined) {
            updates.push(`openai_embeddings_model = $${idx++}`);
            values.push(openaiEmbeddingsModel);
          }

          if (apiKeyRaw !== undefined) {
            const trimmed = apiKeyRaw.trim();
            if (trimmed.length === 0) {
              updates.push(`openai_api_key_ciphertext = NULL`);
              updates.push(`openai_api_key_iv = NULL`);
              updates.push(`openai_api_key_tag = NULL`);
              updates.push(`openai_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
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
            }
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
              openai_api_key_ciphertext IS NOT NULL AS "hasApiKey"
            FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        const response = toApiResponse(updated, env);
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
