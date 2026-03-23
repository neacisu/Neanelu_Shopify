/**
 * Bridge between lex publish worker and Shopify Translation API sync.
 *
 * Best-effort: failures here do NOT block the local publish pipeline.
 * The next publish job or a dedicated retry sweep can pick up missed targets.
 */

import { loadEnv } from '@app/config';
import { createManagedRedis, withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import type { Redis } from 'ioredis';

import {
  bulkRegisterLexTranslationsWithTokenRetry,
  fetchTranslatableContent,
  mapLexFieldToShopifyKey,
  type BulkTranslationEntry,
  type TranslationInput,
} from './lex-shopify-sync.js';
import { withTokenRetry } from '../auth/token-lifecycle.js';

/** Return type of `bulkRegisterLexTranslationsWithTokenRetry` (keeps `logSyncResults` in sync without a separate interface import). */
type LexBulkRegisterTranslationResults = Awaited<
  ReturnType<typeof bulkRegisterLexTranslationsWithTokenRetry>
>;

interface PublishedTargetRow {
  id: string;
  targetType: string;
  targetRecordId: string | null;
  targetPath: string | null;
  localizationId: string | null;
  targetLang: string | null;
  titleText: string | null;
  descriptionText: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  entityType: string | null;
  entityId: string | null;
}

function buildResourceGid(entityType: string | null, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityId.startsWith('gid://')) return entityId;

  switch (entityType) {
    case 'product':
    case 'master_product':
      return `gid://shopify/Product/${entityId}`;
    case 'collection':
      return `gid://shopify/Collection/${entityId}`;
    default:
      return null;
  }
}

function buildTranslationInputsFromTarget(
  target: PublishedTargetRow,
  digestMap: Map<string, string>
): TranslationInput[] {
  const locale = target.targetLang;
  if (!locale) return [];

  const fields: { lexField: string; value: string | null }[] = [
    { lexField: 'title', value: target.titleText },
    { lexField: 'description', value: target.descriptionText },
    { lexField: 'seo_title', value: target.seoTitle },
    { lexField: 'seo_description', value: target.seoDescription },
  ];

  const inputs: TranslationInput[] = [];
  for (const { lexField, value } of fields) {
    if (!value?.trim()) continue;

    const shopifyKey = mapLexFieldToShopifyKey(lexField);
    if (!shopifyKey) continue;

    const digest = digestMap.get(shopifyKey);
    if (!digest) continue;

    inputs.push({
      key: shopifyKey,
      value,
      locale,
      translatableContentDigest: digest,
    });
  }
  return inputs;
}

/**
 * Attempts to sync recently published targets to Shopify via the Translations API.
 * Called from the publish worker; failures are logged but not re-thrown.
 */
export async function syncPublishedTargetsToShopify(params: {
  shopId: string;
  publishedTargetIds: string[];
  logger: Logger;
}): Promise<void> {
  if (params.publishedTargetIds.length === 0) return;

  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const targets = await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<PublishedTargetRow>(
      `SELECT
         pt.id,
         pt.target_type AS "targetType",
         pt.target_record_id AS "targetRecordId",
         pt.target_path AS "targetPath",
         pt.localization_id AS "localizationId",
         l.target_lang AS "targetLang",
         l.title_text AS "titleText",
         l.description_text AS "descriptionText",
         l.seo_title AS "seoTitle",
         l.seo_description AS "seoDescription",
         l.entity_type AS "entityType",
         l.entity_id AS "entityId"
       FROM lex_publication_targets pt
       LEFT JOIN lex_entity_localizations l ON l.id = pt.localization_id
       WHERE pt.id = ANY($1::uuid[])
         AND pt.shop_id = $2
         AND pt.status = 'published'`,
      [params.publishedTargetIds, params.shopId]
    );
    return result.rows;
  });

  if (targets.length === 0) return;

  const resourceTargets = new Map<string, PublishedTargetRow[]>();
  for (const t of targets) {
    const gid = buildResourceGid(t.entityType, t.entityId ?? t.targetRecordId);
    if (!gid) continue;
    const list = resourceTargets.get(gid) ?? [];
    list.push(t);
    resourceTargets.set(gid, list);
  }

  if (resourceTargets.size === 0) return;

  const redis = createManagedRedis('lex-shopify-sync');
  try {
    const entries = await buildBulkEntries({
      shopId: params.shopId,
      encryptionKey,
      resourceTargets,
      redis,
      logger: params.logger,
    });

    if (entries.length === 0) return;

    const results = await bulkRegisterLexTranslationsWithTokenRetry({
      shopId: params.shopId,
      encryptionKey,
      entries,
      redis,
      logger: params.logger,
    });

    logSyncResults(params.shopId, entries.length, results, params.logger);
  } finally {
    await redis.quit().catch((): undefined => undefined);
  }
}

async function buildBulkEntries(ctx: {
  shopId: string;
  encryptionKey: Buffer;
  resourceTargets: Map<string, PublishedTargetRow[]>;
  redis: Redis;
  logger: Logger;
}): Promise<BulkTranslationEntry[]> {
  const entries: BulkTranslationEntry[] = [];

  for (const [resourceId, resourceGroup] of ctx.resourceTargets) {
    const digestMap = await fetchDigestMap(ctx, resourceId);
    if (!digestMap) continue;

    const allInputs: TranslationInput[] = [];
    for (const target of resourceGroup) {
      allInputs.push(...buildTranslationInputsFromTarget(target, digestMap));
    }

    if (allInputs.length > 0) {
      entries.push({ resourceId, translations: allInputs });
    }
  }
  return entries;
}

async function fetchDigestMap(
  ctx: { shopId: string; encryptionKey: Buffer; redis: Redis; logger: Logger },
  resourceId: string
): Promise<Map<string, string> | null> {
  try {
    const content = await withTokenRetry(
      ctx.shopId,
      ctx.encryptionKey,
      ctx.logger,
      async (accessToken, shopDomain) =>
        fetchTranslatableContent({
          shopDomain,
          accessToken,
          resourceId,
          redis: ctx.redis,
          shopId: ctx.shopId,
          logger: ctx.logger,
        })
    );
    return new Map(content.map((c) => [c.key, c.digest]));
  } catch (err) {
    ctx.logger.warn(
      { err, shopId: ctx.shopId, resourceId },
      'lex_shopify_sync_fetch_content_failed'
    );
    return null;
  }
}

function logSyncResults(
  shopId: string,
  totalEntries: number,
  results: LexBulkRegisterTranslationResults,
  logger: Logger
): void {
  let successCount = 0;
  let errorCount = 0;
  for (const r of results) {
    if (r.success) {
      successCount += 1;
    } else {
      errorCount += 1;
      logger.warn(
        { shopId, resourceId: r.resourceId, userErrors: r.userErrors },
        'lex_shopify_sync_partial_failure'
      );
    }
  }

  logger.info({ shopId, successCount, errorCount, totalEntries }, 'lex_shopify_sync_completed');
}
