import { decryptAesGcm, withTenantContext } from '@app/database';
import type { XAICredentials } from '@app/pim';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_DAILY_BUDGET = 1000;
const DEFAULT_ALERT_THRESHOLD = 0.8;

function buildEncryptionKey(encryptionKeyHex: string): Buffer {
  const key = Buffer.from(encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function loadXAICredentials(params: {
  shopId: string;
  encryptionKeyHex: string;
}): Promise<XAICredentials | null> {
  const { shopId, encryptionKeyHex } = params;
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      xai_enabled: boolean;
      xai_api_key_ciphertext: Buffer | null;
      xai_api_key_iv: Buffer | null;
      xai_api_key_tag: Buffer | null;
      xai_base_url: string | null;
      xai_model: string | null;
      xai_temperature: string | number | null;
      xai_max_tokens_per_request: number | null;
      xai_rate_limit_per_minute: number | null;
      xai_daily_budget: number | null;
      xai_budget_alert_threshold: string | number | null;
    }>(
      `SELECT
         xai_enabled,
         xai_api_key_ciphertext,
         xai_api_key_iv,
         xai_api_key_tag,
         xai_base_url,
         xai_model,
         xai_temperature,
         xai_max_tokens_per_request,
         xai_rate_limit_per_minute,
         xai_daily_budget,
         xai_budget_alert_threshold
       FROM shop_ai_credentials
       WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });

  if (!row?.xai_enabled) return null;
  if (!row.xai_api_key_ciphertext || !row.xai_api_key_iv || !row.xai_api_key_tag) {
    return null;
  }

  const apiKey = decryptAesGcm(
    row.xai_api_key_ciphertext,
    buildEncryptionKey(encryptionKeyHex),
    row.xai_api_key_iv,
    row.xai_api_key_tag
  ).toString('utf-8');

  return {
    apiKey,
    baseUrl: row.xai_base_url ?? DEFAULT_BASE_URL,
    model: row.xai_model ?? DEFAULT_MODEL,
    temperature: toNumber(row.xai_temperature) ?? DEFAULT_TEMPERATURE,
    maxTokensPerRequest: row.xai_max_tokens_per_request ?? DEFAULT_MAX_TOKENS,
    rateLimitPerMinute: row.xai_rate_limit_per_minute ?? DEFAULT_RATE_LIMIT,
    dailyBudget: row.xai_daily_budget ?? DEFAULT_DAILY_BUDGET,
    budgetAlertThreshold: toNumber(row.xai_budget_alert_threshold) ?? DEFAULT_ALERT_THRESHOLD,
  };
}
