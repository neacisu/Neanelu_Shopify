import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  PIM_COLLECTIONS_SYNC_JOB,
  PIM_COLLECTIONS_SYNC_QUEUE_NAME,
} from '../../queue/collections-sync-queue.js';

type CollectionsSyncPayload = Readonly<{
  shopId: string;
  trigger: 'manual' | 'scheduled';
}>;

type ProgressJob = Readonly<{
  updateProgress: (progress: number | Record<string, unknown>) => Promise<unknown>;
}>;

export interface CollectionsSyncWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startCollectionsSyncWorker(logger: Logger): CollectionsSyncWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_COLLECTIONS_SYNC_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-collections-sync-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_COLLECTIONS_SYNC_JOB) {
              throw new Error(`unknown_collections_sync_job:${job.name}`);
            }
            const payload = job.data as CollectionsSyncPayload | null;
            if (!payload?.shopId) {
              throw new Error('invalid_collections_sync_payload');
            }
            const fetched = await syncCollections(payload, logger, job);
            try {
              const hierarchy = await syncMenuHierarchy(payload, logger, job);
              safeUpdateProgress(job, {
                phase: 'done',
                fetched,
                menus: hierarchy.menus,
                menuItems: hierarchy.items,
                correlated: hierarchy.correlated,
                percent: 100,
              });
            } catch (err) {
              logger.error(
                { err, shopId: payload.shopId },
                'Collections hierarchy sync failed after collections import'
              );
              safeUpdateProgress(job, {
                phase: 'done',
                fetched,
                hierarchyError: true,
                percent: 100,
              });
            }
          } finally {
            clearWorkerCurrentJob('pim-collections-sync-worker');
          }
        }),
    }
  );
  return { worker, close: async () => await worker.close() };
}

interface ShopifyCollectionNode {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml: string;
  sortOrder: string;
  ruleSet?: {
    appliedDisjunctively: boolean;
    rules: { column: string; relation: string; condition: string }[];
  } | null;
  seo?: { title?: string; description?: string } | null;
  image?: { url?: string } | null;
  productsCount?: { count?: number } | null;
  templateSuffix?: string | null;
  updatedAt?: string | null;
}

interface ShopifyCollectionsResponse {
  collections?: {
    edges?: { cursor: string; node: ShopifyCollectionNode }[];
    pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
  };
}

interface ShopifyMenuHead {
  id: string;
  title: string;
  handle: string;
}

interface ShopifyMenuItemNode {
  id: string;
  title: string;
  url: string | null;
  type: string | null;
  resourceId: string | null;
  tags?: string[] | null;
  items?: ShopifyMenuItemNode[] | null;
}

interface ShopifyMenusResponse {
  menus?: {
    nodes?: ShopifyMenuHead[];
  };
}

interface ShopifyMenuDetailsResponse {
  menu?: {
    id: string;
    title: string;
    handle: string;
    items?: ShopifyMenuItemNode[] | null;
  } | null;
}

interface PersistedMenuItem {
  shopifyGid: string;
  parentShopifyGid: string | null;
  itemType: string | null;
  resourceId: string | null;
}

interface HierarchyMenuItem extends PersistedMenuItem {
  level: number;
  pathSegments: string[];
}

const PRIMARY_COLLECTIONS_MENU_HANDLE = 'categorii-produse';

function countMenuItems(items: readonly ShopifyMenuItemNode[] | null | undefined): number {
  if (!items?.length) return 0;
  return items.reduce((acc, item) => acc + 1 + countMenuItems(item.items), 0);
}

function safeUpdateProgress(job: ProgressJob, progress: number | Record<string, unknown>): void {
  void job.updateProgress(progress).catch(() => undefined);
}

function chooseCanonicalHierarchyItem(
  candidates: readonly HierarchyMenuItem[]
): HierarchyMenuItem | null {
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => {
    if (left.level !== right.level) return left.level - right.level;

    const leftPath = left.pathSegments.join(' > ');
    const rightPath = right.pathSegments.join(' > ');
    if (leftPath.length !== rightPath.length) return leftPath.length - rightPath.length;

    return leftPath.localeCompare(rightPath, 'ro');
  })[0]!;
}

async function syncCollections(
  payload: CollectionsSyncPayload,
  logger: Logger,
  job: ProgressJob
): Promise<number> {
  const env = loadEnv();
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
  let totalFetched = 0;

  while (hasNextPage) {
    const page = await withTokenRetry(
      payload.shopId,
      encryptionKey,
      logger,
      async (token, domain) => {
        const client = shopifyApi.createClient({ shopDomain: domain, accessToken: token });
        return await client.request<ShopifyCollectionsResponse>(query, {
          first: 250,
          after: cursor,
        });
      }
    );

    const edges = page.data?.collections?.edges ?? [];
    if (edges.length > 0) {
      totalFetched += edges.length;
      await withTenantContext(payload.shopId, async (client) => {
        for (const edge of edges) {
          const node = edge.node;
          const legacyResourceIdNum = Number(node.legacyResourceId ?? 0);
          if (!node.id || !Number.isFinite(legacyResourceIdNum) || legacyResourceIdNum <= 0) {
            continue;
          }
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
               updated_at = now(),
               title_en = CASE WHEN shopify_collections.title <> EXCLUDED.title THEN NULL ELSE shopify_collections.title_en END`,
            [
              payload.shopId,
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
              null,
            ]
          );
        }
      });
      safeUpdateProgress(job, {
        phase: 'collections',
        fetched: totalFetched,
        percent: 25,
      });
      logger.info({ shopId: payload.shopId, fetched: totalFetched }, 'Collections sync progress');
    }

    hasNextPage = Boolean(page.data?.collections?.pageInfo?.hasNextPage);
    cursor = page.data?.collections?.pageInfo?.endCursor ?? null;
    if (!cursor) hasNextPage = false;
  }

  logger.info({ shopId: payload.shopId, fetched: totalFetched }, 'Collections sync completed');
  return totalFetched;
}

async function syncMenuHierarchy(
  payload: CollectionsSyncPayload,
  logger: Logger,
  job: ProgressJob
): Promise<{ menus: number; items: number; correlated: number }> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const getMenusQuery = `#graphql
    query GetMenus($first: Int!) {
      menus(first: $first) {
        nodes {
          id
          title
          handle
        }
      }
    }`;

  const menuDetailsQuery = `#graphql
    query GetMenuDetails($id: ID!) {
      menu(id: $id) {
        id
        title
        handle
        items {
          id
          title
          url
          type
          resourceId
          tags
          items {
            id
            title
            url
            type
            resourceId
            tags
            items {
              id
              title
              url
              type
              resourceId
              tags
            }
          }
        }
      }
    }`;

  const menusResponse = await withTokenRetry(
    payload.shopId,
    encryptionKey,
    logger,
    async (token, domain) => {
      const client = shopifyApi.createClient({ shopDomain: domain, accessToken: token });
      return await client.request<ShopifyMenusResponse>(getMenusQuery, { first: 50 });
    }
  );

  const menuHeads = menusResponse.data?.menus?.nodes ?? [];
  const seenMenuGids = new Set<string>();
  const hierarchyMenuItems: HierarchyMenuItem[] = [];
  let totalMenuItems = 0;
  let correlatedCount = 0;
  const primaryMenuHead = menuHeads.find(
    (menuHead) => menuHead.handle === PRIMARY_COLLECTIONS_MENU_HANDLE
  );

  await withTenantContext(payload.shopId, async (client) => {
    for (let menuIndex = 0; menuIndex < menuHeads.length; menuIndex += 1) {
      const menuHead = menuHeads[menuIndex];
      if (!menuHead?.id) continue;

      safeUpdateProgress(job, {
        phase: 'menus',
        current: menuIndex + 1,
        total: menuHeads.length,
        percent:
          menuHeads.length > 0 ? Math.round(60 + ((menuIndex + 1) / menuHeads.length) * 25) : 85,
      });

      const detailsResponse = await withTokenRetry(
        payload.shopId,
        encryptionKey,
        logger,
        async (token, domain) => {
          const shopifyClient = shopifyApi.createClient({
            shopDomain: domain,
            accessToken: token,
          });
          return await shopifyClient.request<ShopifyMenuDetailsResponse>(menuDetailsQuery, {
            id: menuHead.id,
          });
        }
      );

      const menu = detailsResponse.data?.menu;
      if (!menu?.id) continue;

      seenMenuGids.add(menu.id);
      const isPrimaryHierarchyMenu = menu.handle === PRIMARY_COLLECTIONS_MENU_HANDLE;
      const itemCount = countMenuItems(menu.items);
      const menuRow = await client.query<{ id: string }>(
        `INSERT INTO shopify_menus (
           shop_id,
           shopify_gid,
           title,
           handle,
           items_count,
           synced_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (shop_id, shopify_gid) DO UPDATE SET
           title = EXCLUDED.title,
           handle = EXCLUDED.handle,
           items_count = EXCLUDED.items_count,
           synced_at = now(),
           updated_at = now()
         RETURNING id`,
        [payload.shopId, menu.id, menu.title, menu.handle, itemCount]
      );
      const menuDbId = menuRow.rows[0]?.id;
      if (!menuDbId) continue;

      const seenItemGids = new Set<string>();

      const persistItems = async (
        items: readonly ShopifyMenuItemNode[] | null | undefined,
        parentItemId: string | null,
        parentShopifyGid: string | null,
        level: number,
        pathSegments: readonly string[]
      ): Promise<void> => {
        if (!items?.length) return;

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (!item?.id) continue;

          seenItemGids.add(item.id);
          const nextPath = [...pathSegments, item.title];
          const itemRow = await client.query<{ id: string }>(
            `INSERT INTO shopify_menu_items (
               shop_id,
               menu_id,
               shopify_gid,
               parent_item_id,
               title,
               url,
               item_type,
               resource_id,
               position,
               level,
               path
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[])
             ON CONFLICT (shop_id, shopify_gid) DO UPDATE SET
               menu_id = EXCLUDED.menu_id,
               parent_item_id = EXCLUDED.parent_item_id,
               title = EXCLUDED.title,
               url = EXCLUDED.url,
               item_type = EXCLUDED.item_type,
               resource_id = EXCLUDED.resource_id,
               position = EXCLUDED.position,
               level = EXCLUDED.level,
               path = EXCLUDED.path,
               updated_at = now()
             RETURNING id`,
            [
              payload.shopId,
              menuDbId,
              item.id,
              parentItemId,
              item.title,
              item.url,
              item.type,
              item.resourceId,
              index,
              level,
              nextPath,
            ]
          );
          const itemDbId = itemRow.rows[0]?.id;
          if (!itemDbId) continue;

          totalMenuItems += 1;
          if (isPrimaryHierarchyMenu) {
            hierarchyMenuItems.push({
              shopifyGid: item.id,
              parentShopifyGid,
              itemType: item.type,
              resourceId: item.resourceId,
              level,
              pathSegments: nextPath,
            });
          }

          await persistItems(item.items, itemDbId, item.id, level + 1, nextPath);
        }
      };

      await persistItems(menu.items, null, null, 1, []);

      if (seenItemGids.size === 0) {
        await client.query(`DELETE FROM shopify_menu_items WHERE shop_id = $1 AND menu_id = $2`, [
          payload.shopId,
          menuDbId,
        ]);
      } else {
        await client.query(
          `DELETE FROM shopify_menu_items
           WHERE shop_id = $1
             AND menu_id = $2
             AND NOT (shopify_gid = ANY($3::varchar[]))`,
          [payload.shopId, menuDbId, Array.from(seenItemGids)]
        );
      }
    }

    if (seenMenuGids.size === 0) {
      await client.query(`DELETE FROM shopify_menus WHERE shop_id = $1`, [payload.shopId]);
    } else {
      await client.query(
        `DELETE FROM shopify_menus
         WHERE shop_id = $1
           AND NOT (shopify_gid = ANY($2::varchar[]))`,
        [payload.shopId, Array.from(seenMenuGids)]
      );
    }

    safeUpdateProgress(job, { phase: 'hierarchy', status: 'correlating', percent: 90 });

    if (!primaryMenuHead) {
      throw new Error(`primary_collections_menu_missing:${PRIMARY_COLLECTIONS_MENU_HANDLE}`);
    }

    await client.query(
      `UPDATE shopify_collections
       SET menu_level = NULL,
           menu_path = NULL,
           parent_collection_id = NULL
       WHERE shop_id = $1`,
      [payload.shopId]
    );

    const collectionRows = await client.query<{ id: string; shopify_gid: string }>(
      `SELECT id, shopify_gid
       FROM shopify_collections
       WHERE shop_id = $1`,
      [payload.shopId]
    );
    const collectionIdByGid = new Map(
      collectionRows.rows.map((row) => [row.shopify_gid, row.id] as const)
    );
    const primaryHierarchyItemByShopifyGid = new Map(
      hierarchyMenuItems.map((item) => [item.shopifyGid, item] as const)
    );
    const hierarchyCandidatesByResourceId = new Map<string, HierarchyMenuItem[]>();

    for (const item of hierarchyMenuItems) {
      if (item.itemType !== 'COLLECTION' || !item.resourceId) continue;
      const existing = hierarchyCandidatesByResourceId.get(item.resourceId);
      if (existing) {
        existing.push(item);
      } else {
        hierarchyCandidatesByResourceId.set(item.resourceId, [item]);
      }
    }

    for (const [resourceId, candidates] of hierarchyCandidatesByResourceId.entries()) {
      const canonicalItem = chooseCanonicalHierarchyItem(candidates);
      if (!canonicalItem) continue;

      const childCollectionId = collectionIdByGid.get(resourceId);
      if (!childCollectionId) continue;

      let parentMenuItemGid = canonicalItem.parentShopifyGid;
      let parentCollectionId: string | null = null;
      while (parentMenuItemGid) {
        const parentItem = primaryHierarchyItemByShopifyGid.get(parentMenuItemGid);
        if (!parentItem) break;
        if (parentItem.itemType === 'COLLECTION' && parentItem.resourceId) {
          parentCollectionId = collectionIdByGid.get(parentItem.resourceId) ?? null;
          break;
        }
        parentMenuItemGid = parentItem.parentShopifyGid;
      }

      await client.query(
        `UPDATE shopify_collections
         SET menu_level = $1,
             menu_path = $2,
             parent_collection_id = $3
         WHERE id = $4
           AND shop_id = $5`,
        [
          canonicalItem.level - 1,
          canonicalItem.pathSegments.join(' > '),
          parentCollectionId,
          childCollectionId,
          payload.shopId,
        ]
      );
      if (parentCollectionId) {
        correlatedCount += 1;
      }
    }

    logger.info(
      {
        shopId: payload.shopId,
        menuCount: menuHeads.length,
        itemCount: totalMenuItems,
        primaryMenuHandle: PRIMARY_COLLECTIONS_MENU_HANDLE,
        hierarchyCollectionCount: hierarchyCandidatesByResourceId.size,
        correlatedCount,
      },
      'Collections menu hierarchy sync completed'
    );

    safeUpdateProgress(job, {
      phase: 'hierarchy',
      status: 'completed',
      menuItems: totalMenuItems,
      correlated: correlatedCount,
      percent: 98,
    });
  });
  return { menus: menuHeads.length, items: totalMenuItems, correlated: correlatedCount };
}
