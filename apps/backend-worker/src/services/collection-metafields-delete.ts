import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { withTokenRetry } from '../auth/token-lifecycle.js';
import { shopifyApi } from '../shopify/client.js';

const METAFIELDS_DELETE_BATCH_SIZE = 25;

type SchemaRow = Readonly<{ shopify_namespace: string; shopify_key: string }>;

export type MetafieldIdentifierInput = Readonly<{
  ownerId: string;
  namespace: string;
  key: string;
}>;

type MetafieldsDeleteResponse = Readonly<{
  metafieldsDelete?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

export async function loadCollectionMetafieldsToDelete(params: {
  shopId: string;
  collectionId: string;
  taxonomyId: string;
}): Promise<MetafieldIdentifierInput[]> {
  const { shopId, collectionId, taxonomyId } = params;
  const { shopifyGid, schemaRows } = await withTenantContext(shopId, async (client) => {
    const collRes = await client.query<{ shopify_gid: string }>(
      `SELECT shopify_gid FROM shopify_collections
       WHERE id = $1 AND shop_id = $2 LIMIT 1`,
      [collectionId, shopId]
    );
    const row = collRes.rows[0];
    if (!row?.shopify_gid) {
      return { shopifyGid: null as string | null, schemaRows: [] as SchemaRow[] };
    }
    const schemaRes = await client.query<SchemaRow>(
      `SELECT shopify_namespace, shopify_key
       FROM pim_taxonomy_metafield_schema
       WHERE taxonomy_id = $1`,
      [taxonomyId]
    );
    return { shopifyGid: row.shopify_gid, schemaRows: schemaRes.rows };
  });

  if (!shopifyGid || schemaRows.length === 0) {
    return [];
  }

  return schemaRows.map((r) => ({
    ownerId: shopifyGid,
    namespace: r.shopify_namespace,
    key: r.shopify_key,
  }));
}

export async function deleteCollectionMetafieldsForTaxonomy(params: {
  shopId: string;
  collectionId: string;
  taxonomyId: string;
  logger: Logger;
}): Promise<void> {
  const { shopId, collectionId, taxonomyId, logger } = params;
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const identifiers = await loadCollectionMetafieldsToDelete({ shopId, collectionId, taxonomyId });

  if (identifiers.length === 0) {
    return;
  }

  for (let i = 0; i < identifiers.length; i += METAFIELDS_DELETE_BATCH_SIZE) {
    const batch = identifiers.slice(i, i + METAFIELDS_DELETE_BATCH_SIZE);
    const mutation = `#graphql
      mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          userErrors { message }
        }
      }`;
    try {
      const response = await withTokenRetry(
        shopId,
        encryptionKey,
        logger,
        async (accessToken, shopDomain) => {
          const client = shopifyApi.createClient({ shopDomain, accessToken });
          return await client.request<MetafieldsDeleteResponse>(mutation, { metafields: batch });
        }
      );
      const userErrors = response.data?.metafieldsDelete?.userErrors ?? [];
      const realErrors = userErrors.filter((e) => {
        const msg = (e.message ?? '').toLowerCase();
        return !msg.includes('not found') && !msg.includes('does not exist');
      });
      if (userErrors.length > 0 && realErrors.length === 0) {
        logger.info(
          { collectionId, taxonomyId, skipped: userErrors.length },
          'metafieldsDelete: some metafields did not exist on Shopify (skipped)'
        );
      }
      if (realErrors.length > 0) {
        const msg = realErrors
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ');
        throw new Error(msg || 'metafieldsDelete failed');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('metafieldsDelete failed')) {
        throw err;
      }
      logger.warn(
        { collectionId, taxonomyId, error: err instanceof Error ? err.message : String(err) },
        'metafieldsDelete: Shopify API error (non-fatal, continuing)'
      );
    }
  }
}
