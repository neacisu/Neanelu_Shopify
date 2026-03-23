/**
 * Shopify Translation API Sync
 *
 * Bridges local lex publication targets to Shopify's translationsRegister mutation.
 * Handles field mapping, rate limiting (via gateShopifyGraphqlRequest), and bulk batching.
 */

import type { Logger } from '@app/logger';
import type { Redis } from 'ioredis';

import { shopifyApi, type ShopifyGraphQlResponse } from '../shopify/client.js';
import {
  gateShopifyGraphqlRequest,
  syncShopifyGraphqlThrottleStatus,
} from '../shopify/graphql-rate-limit.js';
import { withTokenRetry } from '../auth/token-lifecycle.js';

/**
 * Oglindirea stării de throttle în Redis este best-effort; eșecul nu trebuie să întrerupă
 * fluxul principal GraphQL (f2-01 / f2-04).
 * Exportat pentru teste unitare (comportament de observabilitate).
 */
export function logIgnoredThrottleSyncError(
  logger: Logger | undefined,
  err: unknown,
  meta: Readonly<{ shopId: string; resourceId: string; op: string }>
): void {
  logger?.warn(
    { err, shopId: meta.shopId, resourceId: meta.resourceId, op: meta.op },
    'lex_shopify_sync: throttle status sync failed (non-fatal)'
  );
}

// ---------------------------------------------------------------------------
// GraphQL fragments
// ---------------------------------------------------------------------------

const TRANSLATIONS_REGISTER_MUTATION = `
  mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      userErrors { field, message }
      translations { key, value, locale }
    }
  }
`;

const TRANSLATABLE_CONTENT_QUERY = `
  query translatableContent($resourceId: ID!) {
    translatableResource(resourceId: $resourceId) {
      resourceId
      translatableContent { key, value, digest, locale }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranslationInput {
  key: string;
  value: string;
  locale: string;
  translatableContentDigest: string;
}

export interface ShopifyTranslationResult {
  key: string;
  value: string;
  locale: string;
}

interface TranslationsRegisterData {
  translationsRegister?: {
    userErrors?: { field?: string | null; message: string }[];
    translations?: ShopifyTranslationResult[];
  };
}

export interface TranslatableContentEntry {
  key: string;
  value: string | null;
  digest: string;
  locale: string;
}

interface TranslatableContentData {
  translatableResource?: {
    resourceId: string;
    translatableContent?: TranslatableContentEntry[];
  };
}

export interface RegisterTranslationsResult {
  success: boolean;
  translations: ShopifyTranslationResult[];
  userErrors: { field?: string | null; message: string }[];
}

export interface BulkTranslationItemResult {
  resourceId: string;
  success: boolean;
  translations: ShopifyTranslationResult[];
  userErrors: { field?: string | null; message: string }[];
}

// ---------------------------------------------------------------------------
// f2-02: Field mapping – internal lex columns → Shopify translatable keys
// ---------------------------------------------------------------------------

const LEX_FIELD_TO_SHOPIFY_KEY: Record<string, string> = {
  title: 'title',
  description: 'body_html',
  description_html: 'body_html',
  body_html: 'body_html',
  seo_title: 'meta_title',
  meta_title: 'meta_title',
  seo_description: 'meta_description',
  meta_description: 'meta_description',
  handle: 'handle',
};

/**
 * Maps an internal lex field path to the corresponding Shopify translatable key.
 * Returns `null` for unknown fields.
 */
export function mapLexFieldToShopifyKey(lexField: string): string | null {
  return LEX_FIELD_TO_SHOPIFY_KEY[lexField] ?? null;
}

// ---------------------------------------------------------------------------
// f2-02: Query translatableContent from Shopify
// ---------------------------------------------------------------------------

export async function fetchTranslatableContent(params: {
  shopDomain: string;
  accessToken: string;
  resourceId: string;
  redis: Redis;
  shopId: string;
  logger?: Logger;
}): Promise<TranslatableContentEntry[]> {
  const estimatedCost = 10;
  await gateShopifyGraphqlRequest({
    redis: params.redis,
    shopId: params.shopId,
    costToConsume: estimatedCost,
  });

  const client = shopifyApi.createClient({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
  });

  const response: ShopifyGraphQlResponse<TranslatableContentData> = await client.request(
    TRANSLATABLE_CONTENT_QUERY,
    { resourceId: params.resourceId }
  );

  if (response.extensions?.cost?.throttleStatus) {
    await syncShopifyGraphqlThrottleStatus({
      redis: params.redis,
      shopId: params.shopId,
      throttleStatus: response.extensions.cost.throttleStatus,
    }).catch((err) => {
      logIgnoredThrottleSyncError(params.logger, err, {
        shopId: params.shopId,
        resourceId: params.resourceId,
        op: 'translatable_content_query',
      });
    });
  }

  if (response.errors?.length) {
    const msg = response.errors.map((e) => e.message).join('; ');
    throw new Error(`shopify_translatable_content_query_failed: ${msg}`);
  }

  return response.data?.translatableResource?.translatableContent ?? [];
}

// ---------------------------------------------------------------------------
// f2-01 + f2-04: Register translations with rate limiting
// ---------------------------------------------------------------------------

/**
 * Registers translations for a single Shopify resource via the translationsRegister mutation.
 * Rate limiting is enforced through `gateShopifyGraphqlRequest`.
 */
export async function registerLexTranslationsToShopify(params: {
  shopDomain: string;
  accessToken: string;
  resourceId: string;
  translations: TranslationInput[];
  redis: Redis;
  shopId: string;
  logger?: Logger;
}): Promise<RegisterTranslationsResult> {
  if (params.translations.length === 0) {
    return { success: true, translations: [], userErrors: [] };
  }

  const estimatedCost = 10;
  await gateShopifyGraphqlRequest({
    redis: params.redis,
    shopId: params.shopId,
    costToConsume: estimatedCost,
  });

  const client = shopifyApi.createClient({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
  });

  const response: ShopifyGraphQlResponse<TranslationsRegisterData> = await client.request(
    TRANSLATIONS_REGISTER_MUTATION,
    {
      resourceId: params.resourceId,
      translations: params.translations,
    }
  );

  if (response.extensions?.cost?.throttleStatus) {
    await syncShopifyGraphqlThrottleStatus({
      redis: params.redis,
      shopId: params.shopId,
      throttleStatus: response.extensions.cost.throttleStatus,
    }).catch((err) => {
      logIgnoredThrottleSyncError(params.logger, err, {
        shopId: params.shopId,
        resourceId: params.resourceId,
        op: 'translations_register',
      });
    });
  }

  if (response.errors?.length) {
    const msg = response.errors.map((e) => e.message).join('; ');
    throw new Error(`shopify_translations_register_failed: ${msg}`);
  }

  const data = response.data?.translationsRegister;
  const userErrors = data?.userErrors ?? [];
  const translations = data?.translations ?? [];

  return {
    success: userErrors.length === 0,
    translations,
    userErrors,
  };
}

// ---------------------------------------------------------------------------
// f2-01: Convenience wrapper that uses withTokenRetry
// ---------------------------------------------------------------------------

/**
 * Wraps {@link registerLexTranslationsToShopify} with automatic token decryption and retry.
 */
export async function registerLexTranslationsWithTokenRetry(params: {
  shopId: string;
  encryptionKey: Buffer;
  resourceId: string;
  translations: TranslationInput[];
  redis: Redis;
  logger: Logger;
}): Promise<RegisterTranslationsResult> {
  return withTokenRetry(
    params.shopId,
    params.encryptionKey,
    params.logger,
    async (accessToken, shopDomain) =>
      registerLexTranslationsToShopify({
        shopDomain,
        accessToken,
        resourceId: params.resourceId,
        translations: params.translations,
        redis: params.redis,
        shopId: params.shopId,
        logger: params.logger,
      })
  );
}

// ---------------------------------------------------------------------------
// f2-05: Bulk translation operations
// ---------------------------------------------------------------------------

const MAX_TRANSLATIONS_PER_CALL = 50;

export interface BulkTranslationEntry {
  resourceId: string;
  translations: TranslationInput[];
}

/**
 * Batches multiple translations into fewer `translationsRegister` API calls.
 *
 * - Groups translations by `resourceId`
 * - Sends up to {@link MAX_TRANSLATIONS_PER_CALL} translations per call
 * - Handles partial failures (some batches may fail while others succeed)
 */
export async function bulkRegisterLexTranslations(params: {
  shopDomain: string;
  accessToken: string;
  entries: BulkTranslationEntry[];
  redis: Redis;
  shopId: string;
  logger: Logger;
}): Promise<BulkTranslationItemResult[]> {
  const grouped = new Map<string, TranslationInput[]>();
  for (const entry of params.entries) {
    const existing = grouped.get(entry.resourceId) ?? [];
    existing.push(...entry.translations);
    grouped.set(entry.resourceId, existing);
  }

  const results: BulkTranslationItemResult[] = [];

  for (const [resourceId, allTranslations] of grouped) {
    const chunks = chunkArray(allTranslations, MAX_TRANSLATIONS_PER_CALL);

    for (const chunk of chunks) {
      try {
        const result = await registerLexTranslationsToShopify({
          shopDomain: params.shopDomain,
          accessToken: params.accessToken,
          resourceId,
          translations: chunk,
          redis: params.redis,
          shopId: params.shopId,
          logger: params.logger,
        });

        results.push({
          resourceId,
          success: result.success,
          translations: result.translations,
          userErrors: result.userErrors,
        });
      } catch (error) {
        params.logger.warn(
          {
            shopId: params.shopId,
            resourceId,
            translationsCount: chunk.length,
            err: error,
          },
          'shopify_bulk_translations_register_chunk_failed'
        );

        results.push({
          resourceId,
          success: false,
          translations: [],
          userErrors: [
            {
              field: null,
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    }
  }

  return results;
}

/**
 * Convenience wrapper for bulk with automatic token decryption.
 */
export async function bulkRegisterLexTranslationsWithTokenRetry(params: {
  shopId: string;
  encryptionKey: Buffer;
  entries: BulkTranslationEntry[];
  redis: Redis;
  logger: Logger;
}): Promise<BulkTranslationItemResult[]> {
  return withTokenRetry(
    params.shopId,
    params.encryptionKey,
    params.logger,
    async (accessToken, shopDomain) =>
      bulkRegisterLexTranslations({
        shopDomain,
        accessToken,
        entries: params.entries,
        redis: params.redis,
        shopId: params.shopId,
        logger: params.logger,
      })
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
