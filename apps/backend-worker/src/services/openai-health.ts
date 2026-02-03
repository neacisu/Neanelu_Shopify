import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { AiHealthResponse } from '@app/types';
import { decryptAesGcm, withTenantContext } from '@app/database';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';

export type OpenAiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

function nowIso(): string {
  return new Date().toISOString();
}

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function mapHealthToStatus(health: AiHealthResponse): OpenAiConnectionStatus {
  switch (health.status) {
    case 'ok':
      return 'connected';
    case 'disabled':
      return 'disabled';
    case 'missing_key':
      return 'missing_key';
    case 'error':
    default:
      return 'error';
  }
}

async function updateOpenAiStatus(params: {
  shopId: string;
  status: OpenAiConnectionStatus;
  errorMessage: string | null;
}): Promise<void> {
  const { shopId, status, errorMessage } = params;
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `INSERT INTO shop_ai_credentials (shop_id)
       VALUES ($1)
       ON CONFLICT (shop_id) DO NOTHING`,
      [shopId]
    );

    await client.query(
      `UPDATE shop_ai_credentials
       SET openai_connection_status = $2,
           openai_last_checked_at = now(),
           openai_last_error = $3,
           openai_last_success_at = CASE WHEN $2 = 'connected' THEN now() ELSE openai_last_success_at END,
           updated_at = now()
       WHERE shop_id = $1`,
      [shopId, status, errorMessage]
    );
  });
}

export async function runOpenAiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<AiHealthResponse> {
  const {
    shopId,
    env,
    logger,
    apiKeyOverride = null,
    allowStoredWhenDisabled = false,
    persist = true,
  } = params;

  const config = await getShopOpenAiConfig({ shopId, env, logger });
  const checkedAt = nowIso();
  const baseUrl = config.openAiBaseUrl ?? env.openAiBaseUrl ?? 'https://api.openai.com';
  const model = config.openAiEmbeddingsModel;

  if (!config.enabled && !allowStoredWhenDisabled) {
    const health: AiHealthResponse = {
      status: 'disabled',
      checkedAt,
      message: 'OpenAI este dezactivat pentru acest shop.',
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) await updateOpenAiStatus({ shopId, status: 'disabled', errorMessage: null });
    return health;
  }

  let apiKey = apiKeyOverride ?? config.openAiApiKey;
  if (!apiKey && allowStoredWhenDisabled && !apiKeyOverride) {
    const row = await withTenantContext(shopId, async (client) => {
      const result = await client.query<{
        openai_api_key_ciphertext: Buffer | null;
        openai_api_key_iv: Buffer | null;
        openai_api_key_tag: Buffer | null;
      }>(
        `SELECT openai_api_key_ciphertext, openai_api_key_iv, openai_api_key_tag
           FROM shop_ai_credentials
          WHERE shop_id = $1`,
        [shopId]
      );
      return result.rows[0];
    });
    if (row?.openai_api_key_ciphertext && row.openai_api_key_iv && row.openai_api_key_tag) {
      try {
        apiKey = decryptAesGcm(
          row.openai_api_key_ciphertext,
          buildEncryptionKey(env),
          row.openai_api_key_iv,
          row.openai_api_key_tag
        ).toString('utf-8');
      } catch (error) {
        logger.warn({ shopId, error }, 'Failed to decrypt stored OpenAI API key');
      }
    }
  }

  if (!apiKey) {
    const health: AiHealthResponse = {
      status: 'missing_key',
      checkedAt,
      message: 'Cheia OpenAI lipsește.',
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) await updateOpenAiStatus({ shopId, status: 'missing_key', errorMessage: null });
    return health;
  }

  const controller = new AbortController();
  const timeoutMs = env.openAiTimeoutMs ?? 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const health: AiHealthResponse = {
        status: 'error',
        checkedAt,
        message: `OpenAI a răspuns cu status ${response.status}.`,
        latencyMs,
        httpStatus: response.status,
        baseUrl,
        model,
        source: config.source,
      };
      if (persist) {
        await updateOpenAiStatus({
          shopId,
          status: mapHealthToStatus(health),
          errorMessage: health.message ?? 'openai_error',
        });
      }
      return health;
    }

    const health: AiHealthResponse = {
      status: 'ok',
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) {
      await updateOpenAiStatus({ shopId, status: mapHealthToStatus(health), errorMessage: null });
    }
    return health;
  } catch (error) {
    logger.warn({ error }, 'OpenAI health check failed');
    const latencyMs = Date.now() - startedAt;
    const health: AiHealthResponse = {
      status: 'error',
      checkedAt,
      message: error instanceof Error ? error.message : 'OpenAI health check failed.',
      latencyMs,
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) {
      await updateOpenAiStatus({
        shopId,
        status: mapHealthToStatus(health),
        errorMessage: health.message ?? 'openai_error',
      });
    }
    return health;
  } finally {
    clearTimeout(timeout);
  }
}
