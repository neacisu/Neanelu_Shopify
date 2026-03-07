import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { DeepSeekHealthResponse } from '@app/types';
import { decryptAesGcm, withTenantContext } from '@app/database';

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

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export async function runDeepSeekHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<DeepSeekHealthResponse> {
  const { shopId, env, logger, apiKeyOverride, allowStoredWhenDisabled, persist } = params;
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      deepseek_enabled: boolean;
      deepseek_api_key_ciphertext: Buffer | null;
      deepseek_api_key_iv: Buffer | null;
      deepseek_api_key_tag: Buffer | null;
      deepseek_base_url: string | null;
      deepseek_model: string | null;
    }>(
      `SELECT deepseek_enabled, deepseek_api_key_ciphertext, deepseek_api_key_iv, deepseek_api_key_tag,
              deepseek_base_url, deepseek_model
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
      message: 'Missing DeepSeek configuration',
    };
  }

  if (!apiKeyOverride && !row.deepseek_enabled && !allowStoredWhenDisabled) {
    return { status: 'disabled', checkedAt: nowIso(), message: 'DeepSeek is disabled' };
  }

  if (
    !apiKeyOverride &&
    (!row.deepseek_api_key_ciphertext || !row.deepseek_api_key_iv || !row.deepseek_api_key_tag)
  ) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing DeepSeek API key' };
  }

  const baseUrl = (row.deepseek_base_url ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = row.deepseek_model ?? 'deepseek-chat';
  let apiKey: string;
  if (apiKeyOverride) {
    apiKey = apiKeyOverride;
  } else {
    try {
      apiKey = decryptAesGcm(
        row.deepseek_api_key_ciphertext!,
        buildEncryptionKey(env),
        row.deepseek_api_key_iv!,
        row.deepseek_api_key_tag!
      ).toString('utf-8');
    } catch {
      const result: DeepSeekHealthResponse = {
        status: 'error',
        checkedAt: nowIso(),
        message: 'Encryption key mismatch — please re-save the API key',
      };
      if (persist) {
        await withTenantContext(shopId, async (client) => {
          await client.query(
            `UPDATE shop_ai_credentials
                SET deepseek_connection_status = 'error',
                    deepseek_last_checked_at = now(),
                    deepseek_last_error = $1
              WHERE shop_id = $2`,
            [result.message, shopId]
          );
        });
      }
      return result;
    }
  }

  const start = Date.now();
  let httpStatus: number | undefined;

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    httpStatus = response.status;
    const latencyMs = Date.now() - start;
    const status = response.ok ? 'ok' : 'error';

    let availableModels: string[] | undefined;
    if (response.ok) {
      try {
        const body = (await response.json()) as { data?: { id?: string }[] };
        availableModels = (body.data ?? []).map((m) => m.id ?? '').filter((n) => n.length > 0);
      } catch {
        /* ignore parse errors */
      }
    }

    const result: DeepSeekHealthResponse = {
      status,
      checkedAt: nowIso(),
      latencyMs,
      httpStatus,
      baseUrl,
      model,
      message: response.ok ? 'DeepSeek connection OK' : 'DeepSeek connection failed',
      ...(availableModels ? { availableModels } : {}),
    };

    if (persist) {
      const connectionStatus = response.ok ? 'connected' : 'error';
      await withTenantContext(shopId, async (client) => {
        const modelsArray = availableModels && availableModels.length > 0 ? availableModels : null;
        await client.query(
          `UPDATE shop_ai_credentials
              SET deepseek_connection_status = $1,
                  deepseek_last_checked_at = now(),
                  deepseek_last_error = $2,
                  deepseek_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE deepseek_last_success_at END,
                  deepseek_available_models = COALESCE($4::text[], deepseek_available_models)
            WHERE shop_id = $3`,
          [connectionStatus, response.ok ? null : `HTTP ${httpStatus}`, shopId, modelsArray]
        );
      });
    }

    return result;
  } catch (error) {
    logger.warn({ error }, 'DeepSeek health check failed');
    const result: DeepSeekHealthResponse = {
      status: 'error',
      checkedAt: nowIso(),
      latencyMs: Date.now() - start,
      baseUrl,
      model,
      message: error instanceof Error ? error.message : 'DeepSeek connection failed',
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
    if (persist) {
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shop_ai_credentials
              SET deepseek_connection_status = 'error',
                  deepseek_last_checked_at = now(),
                  deepseek_last_error = $1
            WHERE shop_id = $2`,
          [result.message ?? 'unknown_error', shopId]
        );
      });
    }
    return result;
  }
}
