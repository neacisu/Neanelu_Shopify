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

interface GeminiCredentialsRow {
  gemini_enabled: boolean;
  gemini_api_key_ciphertext: Buffer | null;
  gemini_api_key_iv: Buffer | null;
  gemini_api_key_tag: Buffer | null;
  gemini_model: string | null;
}

function hasGeminiStoredKey(row: GeminiCredentialsRow): boolean {
  return Boolean(row.gemini_api_key_ciphertext && row.gemini_api_key_iv && row.gemini_api_key_tag);
}

async function loadGeminiCredentials(shopId: string): Promise<GeminiCredentialsRow | undefined> {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<GeminiCredentialsRow>(
      `SELECT gemini_enabled, gemini_api_key_ciphertext, gemini_api_key_iv, gemini_api_key_tag,
              gemini_model
         FROM shop_ai_credentials
        WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });
}

async function persistGeminiError(
  shopId: string,
  message: string,
  persist: boolean | undefined
): Promise<void> {
  if (!persist) return;
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `UPDATE shop_ai_credentials
          SET gemini_connection_status = 'error',
              gemini_last_checked_at = now(),
              gemini_last_error = $1
        WHERE shop_id = $2`,
      [message, shopId]
    );
  });
}

async function persistGeminiHealth(params: {
  shopId: string;
  persist: boolean | undefined;
  isOk: boolean;
  httpStatus: number;
  availableModels?: string[];
}): Promise<void> {
  if (!params.persist) return;
  const connectionStatus = params.isOk ? 'connected' : 'error';
  await withTenantContext(params.shopId, async (client) => {
    const modelsArray =
      params.availableModels && params.availableModels.length > 0 ? params.availableModels : null;
    await client.query(
      `UPDATE shop_ai_credentials
          SET gemini_connection_status = $1,
              gemini_last_checked_at = now(),
              gemini_last_error = $2,
              gemini_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE gemini_last_success_at END,
              gemini_available_models = COALESCE($4::text[], gemini_available_models)
        WHERE shop_id = $3`,
      [
        connectionStatus,
        params.isOk ? null : `HTTP ${params.httpStatus}`,
        params.shopId,
        modelsArray,
      ]
    );
  });
}

function parseGeminiModels(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object' || !('models' in body)) return undefined;
  const maybeModels = (body as { models?: { name?: string }[] }).models ?? [];
  const availableModels = maybeModels
    .map((m) => m.name?.replace('models/', '') ?? '')
    .filter((n) => n.length > 0 && (n.includes('gemini') || n.includes('flash')));
  return availableModels.length > 0 ? availableModels : undefined;
}

function geminiPrecheckFailure(params: {
  row: GeminiCredentialsRow;
  hasOverride: boolean;
  allowStoredWhenDisabled: boolean | undefined;
}): GeminiHealthResponse | null {
  const { row, hasOverride, allowStoredWhenDisabled } = params;
  if (!hasOverride && !row.gemini_enabled && !allowStoredWhenDisabled) {
    return { status: 'disabled', checkedAt: nowIso(), message: 'Gemini is disabled' };
  }
  if (!hasOverride && !hasGeminiStoredKey(row)) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini API key' };
  }
  return null;
}

async function resolveGeminiApiKey(params: {
  row: GeminiCredentialsRow;
  env: AppEnv;
  shopId: string;
  apiKeyOverride: string | null | undefined;
  persist: boolean | undefined;
}): Promise<{ apiKey?: string; failure?: GeminiHealthResponse }> {
  const { row, env, shopId, apiKeyOverride, persist } = params;
  if (apiKeyOverride) {
    return { apiKey: apiKeyOverride };
  }

  const ciphertext = row.gemini_api_key_ciphertext;
  const iv = row.gemini_api_key_iv;
  const tag = row.gemini_api_key_tag;
  if (!ciphertext || !iv || !tag) {
    return {
      failure: { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini API key' },
    };
  }

  try {
    const apiKey = decryptAesGcm(ciphertext, buildEncryptionKey(env), iv, tag).toString('utf-8');
    return { apiKey };
  } catch {
    const failure: GeminiHealthResponse = {
      status: 'error',
      checkedAt: nowIso(),
      message: 'Encryption key mismatch — please re-save the API key',
    };
    await persistGeminiError(shopId, failure.message ?? 'unknown_error', persist);
    return { failure };
  }
}

async function callGeminiModelsEndpoint(params: {
  apiKey: string;
  model: string | null;
  start: number;
}): Promise<GeminiHealthResponse> {
  const { apiKey, model, start } = params;
  const response = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
  const latencyMs = Date.now() - start;
  const status = response.ok ? 'ok' : 'error';

  let availableModels: string[] | undefined;
  if (response.ok) {
    try {
      availableModels = parseGeminiModels(await response.json());
    } catch {
      /* ignore parse errors */
    }
  }

  return {
    status,
    checkedAt: nowIso(),
    latencyMs,
    httpStatus: response.status,
    ...(model ? { model } : {}),
    message: response.ok ? 'Gemini connection OK' : 'Gemini connection failed',
    ...(availableModels ? { availableModels } : {}),
  };
}

export async function runGeminiHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<GeminiHealthResponse> {
  const { shopId, env, logger, apiKeyOverride, allowStoredWhenDisabled, persist } = params;
  const row = await loadGeminiCredentials(shopId);

  if (!row) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini configuration' };
  }

  const hasOverride = Boolean(apiKeyOverride);
  const precheckFailure = geminiPrecheckFailure({ row, hasOverride, allowStoredWhenDisabled });
  if (precheckFailure) {
    return precheckFailure;
  }

  const apiKeyResolution = await resolveGeminiApiKey({ row, env, shopId, apiKeyOverride, persist });
  if (apiKeyResolution.failure) {
    return apiKeyResolution.failure;
  }
  const apiKey = apiKeyResolution.apiKey;
  if (!apiKey) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing Gemini API key' };
  }

  const start = Date.now();

  try {
    const result = await callGeminiModelsEndpoint({
      apiKey,
      model: row.gemini_model ?? null,
      start,
    });

    await persistGeminiHealth({
      shopId,
      persist,
      isOk: result.status === 'ok',
      httpStatus: result.httpStatus ?? 0,
      ...(result.availableModels ? { availableModels: result.availableModels } : {}),
    });

    return result;
  } catch (error) {
    logger.warn({ error }, 'Gemini health check failed');
    const errorMessage = error instanceof Error ? error.message : 'Gemini connection failed';
    await persistGeminiError(shopId, errorMessage, persist);
    return {
      status: 'error',
      checkedAt: nowIso(),
      latencyMs: Date.now() - start,
      ...(row.gemini_model ? { model: row.gemini_model } : {}),
      message: errorMessage,
    };
  }
}
