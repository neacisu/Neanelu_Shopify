import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { decryptAesGcm, withTenantContext } from '@app/database';
import type { SerperHealthResponse } from '@app/types';

export type SerperConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

type SerperKeyRow = Readonly<{
  serperEnabled: boolean;
  serperApiKeyCiphertext: Buffer | null;
  serperApiKeyIv: Buffer | null;
  serperApiKeyTag: Buffer | null;
}>;

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function mapHealthToStatus(health: SerperHealthResponse): SerperConnectionStatus {
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

async function updateSerperStatus(params: {
  shopId: string;
  status: SerperConnectionStatus;
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
       SET serper_connection_status = $2,
           serper_last_checked_at = now(),
           serper_last_error = $3,
           serper_last_success_at = CASE WHEN $2 = 'connected' THEN now() ELSE serper_last_success_at END,
           updated_at = now()
       WHERE shop_id = $1`,
      [shopId, status, errorMessage]
    );
  });
}

export async function runSerperHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  apiKeyOverride?: string | null;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<SerperHealthResponse> {
  const {
    shopId,
    env,
    logger,
    apiKeyOverride = null,
    allowStoredWhenDisabled = false,
    persist = true,
  } = params;

  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<SerperKeyRow>(
      `SELECT
        serper_enabled AS "serperEnabled",
        serper_api_key_ciphertext AS "serperApiKeyCiphertext",
        serper_api_key_iv AS "serperApiKeyIv",
        serper_api_key_tag AS "serperApiKeyTag"
      FROM shop_ai_credentials
      WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });

  if (!apiKeyOverride && !allowStoredWhenDisabled && !row?.serperEnabled) {
    const health: SerperHealthResponse = { status: 'disabled' };
    if (persist) await updateSerperStatus({ shopId, status: 'disabled', errorMessage: null });
    return health;
  }

  const storedRow = row ?? null;
  if (
    !apiKeyOverride &&
    (!storedRow?.serperApiKeyCiphertext || !storedRow.serperApiKeyIv || !storedRow.serperApiKeyTag)
  ) {
    const health: SerperHealthResponse = { status: 'missing_key' };
    if (persist) await updateSerperStatus({ shopId, status: 'missing_key', errorMessage: null });
    return health;
  }

  const apiKey = apiKeyOverride
    ? Buffer.from(apiKeyOverride, 'utf-8')
    : decryptAesGcm(
        storedRow!.serperApiKeyCiphertext!,
        buildEncryptionKey(env),
        storedRow!.serperApiKeyIv!,
        storedRow!.serperApiKeyTag!
      );

  const startedAt = Date.now();
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey.toString('utf-8'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: 'test', num: 1 }),
  });
  const responseTimeMs = Date.now() - startedAt;

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).trim();
    } catch {
      detail = '';
    }
    const message = `API returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
    logger.warn(
      { status: response.status, detail: detail ? detail.slice(0, 500) : undefined },
      'Serper health check failed'
    );
    const health: SerperHealthResponse = {
      status: 'error',
      message,
      responseTimeMs,
    };
    if (persist) {
      await updateSerperStatus({ shopId, status: 'error', errorMessage: message });
    }
    return health;
  }

  let creditsRemaining: number | undefined;
  try {
    const data = (await response.json()) as { credits?: unknown };
    if (typeof data.credits === 'number') {
      creditsRemaining = data.credits;
    }
  } catch {
    creditsRemaining = undefined;
  }

  const health: SerperHealthResponse = {
    status: 'ok',
    responseTimeMs,
    ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
  };
  if (persist) {
    await updateSerperStatus({ shopId, status: mapHealthToStatus(health), errorMessage: null });
  }
  return health;
}
