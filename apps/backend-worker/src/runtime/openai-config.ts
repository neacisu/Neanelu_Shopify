import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { decryptAesGcm, withTenantContext } from '@app/database';

export type ShopOpenAiConfig = Readonly<{
  enabled: boolean;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiEmbeddingsModel: string;
  source: 'shop' | 'env' | 'disabled';
}>;

type ShopAiRow = Readonly<{
  enabled: boolean;
  openaiBaseUrl: string | null;
  openaiEmbeddingsModel: string | null;
  openaiApiKeyCiphertext: Buffer | null;
  openaiApiKeyIv: Buffer | null;
  openaiApiKeyTag: Buffer | null;
  openaiKeyVersion: number | null;
}>;

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

export async function getShopOpenAiConfig(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
}): Promise<ShopOpenAiConfig> {
  const { shopId, env, logger } = params;

  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<ShopAiRow>(
      `SELECT enabled,
        openai_base_url AS "openaiBaseUrl",
        openai_embeddings_model AS "openaiEmbeddingsModel",
        openai_api_key_ciphertext AS "openaiApiKeyCiphertext",
        openai_api_key_iv AS "openaiApiKeyIv",
        openai_api_key_tag AS "openaiApiKeyTag",
        openai_key_version AS "openaiKeyVersion"
      FROM shop_ai_credentials
      WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0];
  });

  if (!row) {
    const hasEnvKey = typeof env.openAiApiKey === 'string' && env.openAiApiKey.length > 0;
    return {
      enabled: hasEnvKey,
      ...(hasEnvKey ? { openAiApiKey: env.openAiApiKey } : {}),
      ...(env.openAiBaseUrl ? { openAiBaseUrl: env.openAiBaseUrl } : {}),
      openAiEmbeddingsModel: env.openAiEmbeddingsModel,
      source: hasEnvKey ? 'env' : 'disabled',
    };
  }

  const openAiBaseUrl = row.openaiBaseUrl ?? env.openAiBaseUrl ?? undefined;
  const openAiEmbeddingsModel = row.openaiEmbeddingsModel ?? env.openAiEmbeddingsModel;

  if (!row.enabled) {
    return {
      enabled: false,
      ...(openAiBaseUrl ? { openAiBaseUrl } : {}),
      openAiEmbeddingsModel,
      source: 'disabled',
    };
  }

  if (!row.openaiApiKeyCiphertext || !row.openaiApiKeyIv || !row.openaiApiKeyTag) {
    return {
      enabled: false,
      ...(openAiBaseUrl ? { openAiBaseUrl } : {}),
      openAiEmbeddingsModel,
      source: 'disabled',
    };
  }

  try {
    const key = buildEncryptionKey(env);
    const decrypted = decryptAesGcm(
      row.openaiApiKeyCiphertext,
      key,
      row.openaiApiKeyIv,
      row.openaiApiKeyTag
    );
    return {
      enabled: true,
      openAiApiKey: decrypted.toString('utf-8'),
      ...(openAiBaseUrl ? { openAiBaseUrl } : {}),
      openAiEmbeddingsModel,
      source: 'shop',
    };
  } catch (error) {
    logger.error({ shopId, error }, 'Failed to decrypt OpenAI API key');
    return {
      enabled: false,
      ...(openAiBaseUrl ? { openAiBaseUrl } : {}),
      openAiEmbeddingsModel,
      source: 'disabled',
    };
  }
}
