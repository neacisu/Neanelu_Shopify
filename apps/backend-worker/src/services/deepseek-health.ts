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

interface DeepSeekCredentialsRow {
  deepseek_enabled: boolean;
  deepseek_api_key_ciphertext: Buffer | null;
  deepseek_api_key_iv: Buffer | null;
  deepseek_api_key_tag: Buffer | null;
  deepseek_base_url: string | null;
  deepseek_model: string | null;
}

function hasDeepSeekStoredKey(row: DeepSeekCredentialsRow): boolean {
  return Boolean(
    row.deepseek_api_key_ciphertext && row.deepseek_api_key_iv && row.deepseek_api_key_tag
  );
}

async function loadDeepSeekCredentials(
  shopId: string
): Promise<DeepSeekCredentialsRow | undefined> {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<DeepSeekCredentialsRow>(
      `SELECT deepseek_enabled, deepseek_api_key_ciphertext, deepseek_api_key_iv, deepseek_api_key_tag,
              deepseek_base_url, deepseek_model
         FROM shop_ai_credentials
        WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });
}

async function persistDeepSeekError(
  shopId: string,
  message: string,
  persist: boolean | undefined
): Promise<void> {
  if (!persist) return;
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `UPDATE shop_ai_credentials
          SET deepseek_connection_status = 'error',
              deepseek_last_checked_at = now(),
              deepseek_last_error = $1
        WHERE shop_id = $2`,
      [message, shopId]
    );
  });
}

async function persistDeepSeekHealth(params: {
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
          SET deepseek_connection_status = $1,
              deepseek_last_checked_at = now(),
              deepseek_last_error = $2,
              deepseek_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE deepseek_last_success_at END,
              deepseek_available_models = COALESCE($4::text[], deepseek_available_models)
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

function parseDeepSeekModels(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object' || !('data' in body)) return undefined;
  const maybeData = (body as { data?: { id?: string }[] }).data ?? [];
  const availableModels = maybeData.map((m) => m.id ?? '').filter((n) => n.length > 0);
  return availableModels.length > 0 ? availableModels : undefined;
}

function deepSeekPrecheckFailure(params: {
  row: DeepSeekCredentialsRow;
  hasOverride: boolean;
  allowStoredWhenDisabled: boolean | undefined;
}): DeepSeekHealthResponse | null {
  const { row, hasOverride, allowStoredWhenDisabled } = params;
  if (!hasOverride && !row.deepseek_enabled && !allowStoredWhenDisabled) {
    return { status: 'disabled', checkedAt: nowIso(), message: 'DeepSeek is disabled' };
  }
  if (!hasOverride && !hasDeepSeekStoredKey(row)) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing DeepSeek API key' };
  }
  return null;
}

async function resolveDeepSeekApiKey(params: {
  row: DeepSeekCredentialsRow;
  env: AppEnv;
  shopId: string;
  apiKeyOverride: string | null | undefined;
  persist: boolean | undefined;
}): Promise<{ apiKey?: string; failure?: DeepSeekHealthResponse }> {
  const { row, env, shopId, apiKeyOverride, persist } = params;
  if (apiKeyOverride) {
    return { apiKey: apiKeyOverride };
  }

  const ciphertext = row.deepseek_api_key_ciphertext;
  const iv = row.deepseek_api_key_iv;
  const tag = row.deepseek_api_key_tag;
  if (!ciphertext || !iv || !tag) {
    return {
      failure: { status: 'missing_key', checkedAt: nowIso(), message: 'Missing DeepSeek API key' },
    };
  }

  try {
    const apiKey = decryptAesGcm(ciphertext, buildEncryptionKey(env), iv, tag).toString('utf-8');
    return { apiKey };
  } catch {
    const failure: DeepSeekHealthResponse = {
      status: 'error',
      checkedAt: nowIso(),
      message: 'Encryption key mismatch — please re-save the API key',
    };
    await persistDeepSeekError(shopId, failure.message ?? 'unknown_error', persist);
    return { failure };
  }
}

async function callDeepSeekModelsEndpoint(params: {
  baseUrl: string;
  model: string;
  apiKey: string;
  start: number;
}): Promise<DeepSeekHealthResponse> {
  const { baseUrl, model, apiKey, start } = params;
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const latencyMs = Date.now() - start;
  const status = response.ok ? 'ok' : 'error';

  let availableModels: string[] | undefined;
  if (response.ok) {
    try {
      availableModels = parseDeepSeekModels(await response.json());
    } catch {
      /* ignore parse errors */
    }
  }

  return {
    status,
    checkedAt: nowIso(),
    latencyMs,
    httpStatus: response.status,
    baseUrl,
    model,
    message: response.ok ? 'DeepSeek connection OK' : 'DeepSeek connection failed',
    ...(availableModels ? { availableModels } : {}),
  };
}

export async function runDeepSeekHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<DeepSeekHealthResponse> {
  const { shopId, env, logger, apiKeyOverride, allowStoredWhenDisabled, persist } = params;
  const row = await loadDeepSeekCredentials(shopId);

  if (!row) {
    return {
      status: 'missing_key',
      checkedAt: nowIso(),
      message: 'Missing DeepSeek configuration',
    };
  }

  const hasOverride = Boolean(apiKeyOverride);
  const precheckFailure = deepSeekPrecheckFailure({ row, hasOverride, allowStoredWhenDisabled });
  if (precheckFailure) {
    return precheckFailure;
  }

  const baseUrl = (row.deepseek_base_url ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = row.deepseek_model ?? 'deepseek-chat';
  const apiKeyResolution = await resolveDeepSeekApiKey({
    row,
    env,
    shopId,
    apiKeyOverride,
    persist,
  });
  if (apiKeyResolution.failure) {
    return apiKeyResolution.failure;
  }
  const apiKey = apiKeyResolution.apiKey;
  if (!apiKey) {
    return { status: 'missing_key', checkedAt: nowIso(), message: 'Missing DeepSeek API key' };
  }

  const start = Date.now();

  try {
    const result = await callDeepSeekModelsEndpoint({ baseUrl, model, apiKey, start });

    await persistDeepSeekHealth({
      shopId,
      persist,
      isOk: result.status === 'ok',
      httpStatus: result.httpStatus ?? 0,
      ...(result.availableModels ? { availableModels: result.availableModels } : {}),
    });

    return result;
  } catch (error) {
    logger.warn({ error }, 'DeepSeek health check failed');
    const errorMessage = error instanceof Error ? error.message : 'DeepSeek connection failed';
    await persistDeepSeekError(shopId, errorMessage, persist);
    return {
      status: 'error',
      checkedAt: nowIso(),
      latencyMs: Date.now() - start,
      baseUrl,
      model,
      message: errorMessage,
    };
  }
}
