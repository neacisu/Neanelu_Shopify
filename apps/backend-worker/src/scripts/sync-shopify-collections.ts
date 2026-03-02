import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { createLogger } from '@app/logger';
import { withTokenRetry } from '../auth/token-lifecycle.js';
import { shopifyApi } from '../shopify/client.js';

type ShopifyCollectionNode = Readonly<{
  id: string;
  legacyResourceId: string | number | null;
  title: string;
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  sortOrder: string | null;
  ruleSet: Readonly<{
    appliedDisjunctively?: boolean | null;
    rules?:
      | readonly Readonly<{
          column?: string | null;
          relation?: string | null;
          condition?: string | null;
        }>[]
      | null;
  }> | null;
  seo: Readonly<{
    title?: string | null;
    description?: string | null;
  }> | null;
  image: Readonly<{
    url?: string | null;
  }> | null;
  productsCount: Readonly<{
    count?: number | null;
  }> | null;
  templateSuffix: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
}>;

type CollectionsResponse = Readonly<{
  collections?: Readonly<{
    edges?:
      | readonly Readonly<{
          cursor: string;
          node: ShopifyCollectionNode;
        }>[]
      | null;
    pageInfo?: Readonly<{
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    }> | null;
  }> | null;
}>;

function parseArgs(): { shopId: string } {
  const shopIdArg = process.argv.find((arg) => arg.startsWith('--shop-id=')) ?? '';
  const shopId = shopIdArg.slice('--shop-id='.length).trim();
  if (!shopId) {
    throw new Error('Missing --shop-id=<uuid>');
  }
  return { shopId };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    service: 'sync-shopify-collections',
    env: env.nodeEnv,
    level: env.logLevel,
  });
  const { shopId } = parseArgs();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const query = `#graphql
    query CollectionsPage($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            legacyResourceId
            title
            handle
            description
            descriptionHtml
            sortOrder
            ruleSet {
              appliedDisjunctively
              rules {
                column
                relation
                condition
              }
            }
            seo {
              title
              description
            }
            image {
              url
            }
            productsCount {
              count
            }
            templateSuffix
            updatedAt
            publishedAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;

  let cursor: string | null = null;
  let hasNextPage = true;
  let total = 0;

  while (hasNextPage) {
    const page = await withTokenRetry(shopId, encryptionKey, logger, async (token, domain) => {
      const client = shopifyApi.createClient({ shopDomain: domain, accessToken: token });
      return await client.request<CollectionsResponse>(query, { first: 250, after: cursor });
    });
    const edges = page.data?.collections?.edges ?? [];
    if (edges.length > 0) {
      await withTenantContext(shopId, async (client) => {
        for (const edge of edges) {
          const node = edge.node;
          const legacyResourceIdNum = Number(node.legacyResourceId ?? 0);
          if (!node.id || !Number.isFinite(legacyResourceIdNum) || legacyResourceIdNum <= 0)
            continue;
          const rules = node.ruleSet?.rules ?? [];
          const collectionType = rules.length > 0 ? 'SMART' : 'MANUAL';
          await client.query(
            `INSERT INTO shopify_collections (
               shop_id,
               shopify_gid,
               legacy_resource_id,
               title,
               handle,
               description,
               description_html,
               collection_type,
               sort_order,
               rules,
               disjunctive,
               seo,
               image_url,
               products_count,
               template_suffix,
               published_at,
               synced_at,
               updated_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16::timestamptz, now(), now()
             )
             ON CONFLICT (shop_id, shopify_gid) DO UPDATE SET
               legacy_resource_id = EXCLUDED.legacy_resource_id,
               title = EXCLUDED.title,
               handle = EXCLUDED.handle,
               description = EXCLUDED.description,
               description_html = EXCLUDED.description_html,
               collection_type = EXCLUDED.collection_type,
               sort_order = EXCLUDED.sort_order,
               rules = EXCLUDED.rules,
               disjunctive = EXCLUDED.disjunctive,
               seo = EXCLUDED.seo,
               image_url = EXCLUDED.image_url,
               products_count = EXCLUDED.products_count,
               template_suffix = EXCLUDED.template_suffix,
               published_at = EXCLUDED.published_at,
               synced_at = now(),
               updated_at = now()`,
            [
              shopId,
              node.id,
              legacyResourceIdNum,
              node.title,
              node.handle,
              node.description,
              node.descriptionHtml,
              collectionType,
              node.sortOrder,
              JSON.stringify(rules),
              Boolean(node.ruleSet?.appliedDisjunctively ?? false),
              JSON.stringify(node.seo ?? {}),
              node.image?.url ?? null,
              Number(node.productsCount?.count ?? 0),
              node.templateSuffix,
              node.publishedAt,
            ]
          );
        }
      });
      total += edges.length;
      logger.info({ syncedCollections: total }, 'collections sync progress');
    }

    hasNextPage = Boolean(page.data?.collections?.pageInfo?.hasNextPage);
    cursor = page.data?.collections?.pageInfo?.endCursor ?? null;
    if (!cursor) hasNextPage = false;
  }

  logger.info({ syncedCollections: total }, 'collections sync completed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
