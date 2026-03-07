import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { GeminiHealthResponse } from '@app/types';
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

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function runGeminiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<GeminiHealthResponse> {
  const { shopId, env, logger, apiKeyOverride, allowStoredWhenDisabled, persist } = params;
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      gemini_enabled: boolean;
      gemini_api_key_ciphertext: Buffer | null;
      gemini_api_key_iv: Buffer | null;
      gemini_api_key_tag: Buffer | null;
      gemini_model: string | null;
    }>(
      `SELECT gemini_enabled, gemini_api_key_ciphertext, gemini_api_key_iv, gemini_api_key_tag,
              gemini_model
         FROM shop_ai_credentials
        WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });

  if (!row) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini configuration' };
  }

  if (!apiKeyOverride && !row.gemini_enabled && !allowStoredWhenDisabled) {
    return { status: 'disabled', checkedAt: nowIso(), message: 'Gemini is disabled' };
  }

  if (
    !apiKeyOverride &&
    (!row.gemini_api_key_ciphertext || !row.gemini_api_key_iv || !row.gemini_api_key_tag)
  ) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini API key' };
  }

  let apiKey: string;
  if (apiKeyOverride) {
    apiKey = apiKeyOverride;
  } else {
    try {
      apiKey = decryptAesGcm(
        row.gemini_api_key_ciphertext!,
        buildEncryptionKey(env),
        row.gemini_api_key_iv!,
        row.gemini_api_key_tag!
      ).toString('utf-8');
    } catch {
      const result: GeminiHealthResponse = {
        status: 'error',
        checkedAt: nowIso(),
        message: 'Encryption key mismatch — please re-save the API key',
      };
      if (persist) {
        await withTenantContext(shopId, async (client) => {
          await client.query(
            `UPDATE shop_ai_credentials
                SET gemini_connection_status = 'error',
                    gemini_last_checked_at = now(),
                    gemini_last_error = $1
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
    const response = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
    httpStatus = response.status;
    const latencyMs = Date.now() - start;
    const status = response.ok ? 'ok' : 'error';

    let availableModels: string[] | undefined;
    if (response.ok) {
      try {
        const body = (await response.json()) as { models?: { name?: string }[] };
        availableModels = (body.models ?? [])
          .map((m) => m.name?.replace('models/', '') ?? '')
          .filter((n) => n.length > 0 && (n.includes('gemini') || n.includes('flash')));
      } catch {
        /* ignore parse errors */
      }
    }

    const result: GeminiHealthResponse = {
      status,
      checkedAt: nowIso(),
      latencyMs,
      httpStatus,
      ...(row.gemini_model ? { model: row.gemini_model } : {}),
      message: response.ok ? 'Gemini connection OK' : 'Gemini connection failed',
      ...(availableModels ? { availableModels } : {}),
    };

    if (persist) {
      const connectionStatus = response.ok ? 'connected' : 'error';
      await withTenantContext(shopId, async (client) => {
        const modelsArray = availableModels && availableModels.length > 0 ? availableModels : null;
        await client.query(
          `UPDATE shop_ai_credentials
              SET gemini_connection_status = $1,
                  gemini_last_checked_at = now(),
                  gemini_last_error = $2,
                  gemini_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE gemini_last_success_at END,
                  gemini_available_models = COALESCE($4::text[], gemini_available_models)
            WHERE shop_id = $3`,
          [connectionStatus, response.ok ? null : `HTTP ${httpStatus}`, shopId, modelsArray]
        );
      });
    }

    return result;
  } catch (error) {
    logger.warn({ error }, 'Gemini health check failed');
    const result: GeminiHealthResponse = {
      status: 'error',
      checkedAt: nowIso(),
      latencyMs: Date.now() - start,
      ...(row.gemini_model ? { model: row.gemini_model } : {}),
      message: error instanceof Error ? error.message : 'Gemini connection failed',
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
    if (persist) {
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shop_ai_credentials
              SET gemini_connection_status = 'error',
                  gemini_last_checked_at = now(),
                  gemini_last_error = $1
            WHERE shop_id = $2`,
          [result.message ?? 'unknown_error', shopId]
        );
      });
    }
    return result;
  }
}
