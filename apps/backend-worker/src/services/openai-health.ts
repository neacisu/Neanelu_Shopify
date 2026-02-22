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
  availableModels?: string[] | null;
}): Promise<void> {
  const { shopId, status, errorMessage, availableModels = null } = params;
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
           openai_available_models = COALESCE($4, openai_available_models),
           openai_last_success_at = CASE WHEN $2 = 'connected' THEN now() ELSE openai_last_success_at END,
           updated_at = now()
       WHERE shop_id = $1`,
      [shopId, status, errorMessage, availableModels]
    );
  });
}

async function updateOpenAiModels(params: {
  shopId: string;
  availableModels: string[];
}): Promise<void> {
  const { shopId, availableModels } = params;
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `INSERT INTO shop_ai_credentials (shop_id)
       VALUES ($1)
       ON CONFLICT (shop_id) DO NOTHING`,
      [shopId]
    );
    await client.query(
      `UPDATE shop_ai_credentials
         SET openai_available_models = $2,
             updated_at = now()
       WHERE shop_id = $1`,
      [shopId, availableModels]
    );
  });
}

function extractEmbeddingModels(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as { data?: unknown };
  if (!Array.isArray(obj.data)) return null;

  const ids: string[] = [];
  for (const entry of obj.data) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id === 'string' && id.includes('embedding')) {
      ids.push(id);
    }
  }
  if (ids.length === 0) return [];
  return Array.from(new Set(ids)).sort();
}

export async function runOpenAiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
  persistModels?: boolean;
}): Promise<AiHealthResponse> {
  const {
    shopId,
    env,
    logger,
    apiKeyOverride = null,
    allowStoredWhenDisabled = false,
    persist = true,
    persistModels = false,
  } = params;

  const config = await getShopOpenAiConfig({ shopId, env, logger });
  const checkedAt = nowIso();
  const baseUrl = config.openAiBaseUrl ?? env.openAiBaseUrl ?? 'https://api.openai.com';
  const model = config.openAiEmbeddingsModel;

  // If we have a stored key but it can't be decrypted (e.g. encryption key rotated),
  // surface that fact instead of reporting "missing_key".
  if (config.problem === 'decrypt_failed' && !apiKeyOverride) {
    const health: AiHealthResponse = {
      status: 'error',
      checkedAt,
      message:
        'Cheia OpenAI este stocata, dar nu se poate decripta (encryption key mismatch). Reintrodu cheia si salveaza din nou.',
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) {
      await updateOpenAiStatus({
        shopId,
        status: mapHealthToStatus(health),
        errorMessage: health.message ?? 'openai_key_decrypt_failed',
      });
    }
    return health;
  }

  // "Test conexiune" should be able to validate an override key even when the shop is disabled.
  // Only block when we rely on stored config (no override).
  if (!config.enabled && !allowStoredWhenDisabled && !apiKeyOverride) {
    const health: AiHealthResponse = {
      status: 'disabled',
      checkedAt,
      message: 'OpenAI este dezactivat pentru acest shop.',
      baseUrl,
      model,
      source: config.source,
    };
    if (persist) {
      await updateOpenAiStatus({ shopId, status: 'disabled', errorMessage: null });
    }
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
    let decryptFailed: string | null = null;
    if (row?.openai_api_key_ciphertext && row.openai_api_key_iv && row.openai_api_key_tag) {
      try {
        apiKey = decryptAesGcm(
          row.openai_api_key_ciphertext,
          buildEncryptionKey(env),
          row.openai_api_key_iv,
          row.openai_api_key_tag
        ).toString('utf-8');
      } catch (error) {
        decryptFailed = error instanceof Error ? error.message : String(error);
        logger.warn({ shopId, error }, 'Failed to decrypt stored OpenAI API key');
      }
    }

    if (!apiKey && decryptFailed) {
      const health: AiHealthResponse = {
        status: 'error',
        checkedAt,
        message:
          'Cheia OpenAI este stocata, dar nu se poate decripta (encryption key mismatch). Reintrodu cheia si salveaza din nou.',
        baseUrl,
        model,
        source: config.source,
      };
      if (persist) {
        await updateOpenAiStatus({
          shopId,
          status: mapHealthToStatus(health),
          errorMessage: health.message ?? 'openai_key_decrypt_failed',
        });
      }
      return health;
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
    if (persist) {
      await updateOpenAiStatus({ shopId, status: 'missing_key', errorMessage: null });
    }
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

    // Best-effort: parse models list (some mocks/tests might not provide a JSON body).
    let availableModels: string[] | null = null;
    try {
      const payload: unknown = await response.json();
      availableModels = extractEmbeddingModels(payload);
    } catch {
      availableModels = null;
    }

    const health: AiHealthResponse = {
      status: 'ok',
      checkedAt,
      latencyMs,
      httpStatus: response.status,
      baseUrl,
      model,
      source: config.source,
      ...(availableModels !== null ? { availableModels } : {}),
    };
    if (persist) {
      await updateOpenAiStatus({
        shopId,
        status: mapHealthToStatus(health),
        errorMessage: null,
        availableModels,
      });
    } else if (persistModels && Array.isArray(availableModels)) {
      await updateOpenAiModels({ shopId, availableModels });
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
