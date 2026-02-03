import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { XaiHealthResponse } from '@app/types';
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

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';

export async function runXaiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<XaiHealthResponse> {
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
      buildEncryptionKey(env),
      row.xai_api_key_iv!,
      row.xai_api_key_tag!
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
    const status = response.ok ? 'ok' : 'error';
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
      const connectionStatus = response.ok ? 'connected' : 'error';
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shop_ai_credentials
              SET xai_connection_status = $1,
                  xai_last_checked_at = now(),
                  xai_last_error = $2,
                  xai_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE xai_last_success_at END
            WHERE shop_id = $3`,
          [connectionStatus, response.ok ? null : `HTTP ${httpStatus}`, shopId]
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
