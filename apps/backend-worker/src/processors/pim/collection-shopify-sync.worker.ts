import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  COLLECTION_SHOPIFY_SYNC_JOB,
  COLLECTION_SHOPIFY_SYNC_QUEUE_NAME,
  type CollectionShopifySyncJobData,
} from '../../queue/collection-shopify-sync-queue.js';
import { pushCollectionMetafields } from './collection-metafield-push.worker.js';
import { deleteCollectionMetafieldsForTaxonomy } from '../../services/collection-metafields-delete.js';
import {
  markPendingCollectionChangeFailed,
  markPendingCollectionChangeSynced,
} from '../../services/collection-pending-changes.js';

type CollectionUpdateResponse = Readonly<{
  collectionUpdate?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

type MenuNode = Readonly<{
  id: string;
  title: string;
  url: string | null;
  type: string;
  resourceId: string | null;
  tags: readonly string[] | null;
  items?: readonly MenuNode[];
}>;

type MenuQueryResponse = Readonly<{
  menu?: Readonly<{
    id: string;
    title: string;
    handle: string;
    items: readonly MenuNode[];
  }> | null;
}>;

interface MenuUpdateInput {
  id?: string;
  title: string;
  type: string;
  resourceId?: string;
  url?: string;
  tags?: string[];
  items?: MenuUpdateInput[];
}

type MenuUpdateResponse = Readonly<{
  menuUpdate?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

export interface CollectionShopifySyncWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startCollectionShopifySyncWorker(
  logger: Logger
): CollectionShopifySyncWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: COLLECTION_SHOPIFY_SYNC_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('collection-shopify-sync-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== COLLECTION_SHOPIFY_SYNC_JOB) {
              throw new Error(`unknown_collection_shopify_sync_job:${job.name}`);
            }

            const payload = job.data as CollectionShopifySyncJobData | null;
            if (
              !payload?.shopId ||
              !payload.changeId ||
              !payload.collectionId ||
              !payload.changeType
            ) {
              throw new Error('invalid_collection_shopify_sync_payload');
            }

            await processCollectionShopifySync(payload, logger);
          } finally {
            clearWorkerCurrentJob('collection-shopify-sync-worker');
          }
        }),
    }
  );
  return { worker, close: async () => await worker.close() };
}

async function processCollectionShopifySync(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  try {
    switch (payload.changeType) {
      case 'field_update':
        await processFieldUpdate(payload, logger);
        break;
      case 'taxonomy_assign':
        await processTaxonomyAssign(payload, logger);
        break;
      case 'taxonomy_unassign':
        await processTaxonomyUnassign(payload, logger);
        break;
      case 'menu_assign':
        await processMenuAssign(payload, logger);
        break;
      case 'product_dissociate':
        await processProductDissociate(payload, logger);
        break;
      case 'metafield_definition_create':
        await processMetafieldDefinitionCreate(payload, logger);
        break;
      default:
        throw new Error(`unsupported_collection_change_type:${String(payload.changeType)}`);
    }

    const batchedOps = payload.metadata['batchedOperations'] as { changeId: string }[] | undefined;
    if (batchedOps?.length) {
      for (const op of batchedOps) {
        await markPendingCollectionChangeSynced(payload.shopId, op.changeId);
      }
    } else {
      await markPendingCollectionChangeSynced(payload.shopId, payload.changeId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'collection_shopify_sync_failed';
    const batchedOps = payload.metadata['batchedOperations'] as { changeId: string }[] | undefined;
    if (batchedOps?.length) {
      for (const op of batchedOps) {
        await markPendingCollectionChangeFailed(payload.shopId, op.changeId, message);
      }
    } else {
      await markPendingCollectionChangeFailed(payload.shopId, payload.changeId, message);
    }
    throw error;
  }
}

async function processFieldUpdate(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
  const collection = await withTenantContext(payload.shopId, async (client) => {
    const result = await client.query<{ shopify_gid: string }>(
      `SELECT shopify_gid
         FROM shopify_collections
        WHERE shop_id = $1
          AND id = $2
        LIMIT 1`,
      [payload.shopId, payload.collectionId]
    );
    return result.rows[0] ?? null;
  });
  if (!collection?.shopify_gid) {
    throw new Error('collection_shopify_gid_missing');
  }

  if (payload.fieldName !== 'title' && payload.fieldName !== 'description') {
    throw new Error(`unsupported_field_update:${String(payload.fieldName)}`);
  }

  const input =
    payload.fieldName === 'title'
      ? { id: collection.shopify_gid, title: payload.newValue ?? '' }
      : { id: collection.shopify_gid, descriptionHtml: payload.newValue ?? '' };

  const mutation = `#graphql
    mutation CollectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        userErrors {
          message
        }
      }
    }`;

  const response = await withTokenRetry(
    payload.shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<CollectionUpdateResponse>(mutation, { input });
    }
  );

  const userErrors = response.data?.collectionUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join('; ') || 'collection_update_failed'
    );
  }
}

async function processTaxonomyAssign(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  await pushCollectionMetafields({
    shopId: payload.shopId,
    collectionId: payload.collectionId,
    logger,
  });
}

async function processTaxonomyUnassign(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const taxonomyId =
    typeof payload.metadata['taxonomyId'] === 'string' ? payload.metadata['taxonomyId'] : null;
  if (!taxonomyId) {
    throw new Error('taxonomy_unassign_missing_taxonomy_id');
  }
  await deleteCollectionMetafieldsForTaxonomy({
    shopId: payload.shopId,
    collectionId: payload.collectionId,
    taxonomyId,
    logger,
  });
}

interface MenuOperation {
  action: string;
  collectionGid: string;
  collectionTitle: string;
  parentMenuItemId?: string | undefined;
  menuItemIdToRemove?: string | undefined;
}

interface ThemeCollectionListOp {
  parentCollectionGid: string;
  childCollectionGid: string;
  action: 'add' | 'remove';
}

function findParentOfResourceId(
  nodes: MenuUpdateInput[],
  resourceId: string,
  parent: MenuUpdateInput | null = null
): MenuUpdateInput | null {
  for (const node of nodes) {
    if (node.resourceId === resourceId) return parent;
    if (node.items) {
      const found = findParentOfResourceId(node.items, resourceId, node);
      if (found) return found;
    }
  }
  return null;
}

function findParentOfNodeById(
  nodes: MenuUpdateInput[],
  nodeId: string,
  parent: MenuUpdateInput | null = null
): MenuUpdateInput | null {
  for (const node of nodes) {
    if (node.id === nodeId) return parent;
    if (node.items) {
      const found = findParentOfNodeById(node.items, nodeId, node);
      if (found) return found;
    }
  }
  return null;
}

function collectThemeOps(
  items: MenuUpdateInput[],
  operations: MenuOperation[]
): ThemeCollectionListOp[] {
  const themeOps: ThemeCollectionListOp[] = [];

  for (const op of operations) {
    if (!op.collectionGid) continue;

    switch (op.action) {
      case 'add': {
        if (!op.parentMenuItemId) break;
        const parent = findMenuNodeById(items, op.parentMenuItemId);
        if (parent?.resourceId) {
          themeOps.push({
            parentCollectionGid: parent.resourceId,
            childCollectionGid: op.collectionGid,
            action: 'add',
          });
        }
        break;
      }
      case 'remove': {
        let parentNode: MenuUpdateInput | null = null;
        if (op.menuItemIdToRemove) {
          parentNode = findParentOfNodeById(items, op.menuItemIdToRemove);
        }
        parentNode ??= findParentOfResourceId(items, op.collectionGid);
        if (parentNode?.resourceId) {
          themeOps.push({
            parentCollectionGid: parentNode.resourceId,
            childCollectionGid: op.collectionGid,
            action: 'remove',
          });
        }
        break;
      }
      case 'move': {
        const currentParent = findParentOfResourceId(items, op.collectionGid);
        if (currentParent?.resourceId) {
          themeOps.push({
            parentCollectionGid: currentParent.resourceId,
            childCollectionGid: op.collectionGid,
            action: 'remove',
          });
        }
        if (op.parentMenuItemId) {
          const newParent = findMenuNodeById(items, op.parentMenuItemId);
          if (newParent?.resourceId) {
            themeOps.push({
              parentCollectionGid: newParent.resourceId,
              childCollectionGid: op.collectionGid,
              action: 'add',
            });
          }
        }
        break;
      }
    }
  }

  return themeOps;
}

interface ThemesRestResponse {
  themes?: { id: number; role: string }[];
}
interface AssetRestResponse {
  asset?: { key: string; value: string };
  errors?: unknown;
}

async function syncThemeCollectionLists(
  shopId: string,
  themeOps: ThemeCollectionListOp[],
  encryptionKey: Buffer,
  logger: Logger
): Promise<void> {
  if (themeOps.length === 0) return;

  const allGids = new Set<string>();
  for (const op of themeOps) {
    allGids.add(op.parentCollectionGid);
    allGids.add(op.childCollectionGid);
  }
  const gidList = [...allGids];

  const aliases = gidList
    .map((gid, i) => `c${i}: collection(id: "${gid}") { id handle templateSuffix }`)
    .join('\n');

  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  type CollInfo = { id: string; handle: string; templateSuffix: string | null };
  const collResponse = await withTokenRetry(
    shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<Record<string, CollInfo | null>>(`{ ${aliases} }`, {});
    }
  );

  const collectionMap = new Map<string, CollInfo>();
  for (let i = 0; i < gidList.length; i++) {
    const info = collResponse.data?.[`c${i}`];
    const gid = gidList[i];
    if (info && gid) collectionMap.set(gid, info);
  }

  const themeResponse = await withTokenRetry(
    shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const resp = await fetch(`https://${shopDomain}/admin/api/2025-10/themes.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken },
      });
      return (await resp.json()) as ThemesRestResponse;
    }
  );
  const mainTheme = themeResponse.themes?.find((t) => t.role === 'main');
  if (!mainTheme) {
    logger.warn({ shopId }, 'theme_sync: no main theme found');
    return;
  }
  const themeId = mainTheme.id;

  const byParent = new Map<string, ThemeCollectionListOp[]>();
  for (const op of themeOps) {
    const group = byParent.get(op.parentCollectionGid) ?? [];
    group.push(op);
    byParent.set(op.parentCollectionGid, group);
  }

  for (const [parentGid, parentOps] of byParent) {
    const parentInfo = collectionMap.get(parentGid);
    if (!parentInfo?.templateSuffix) {
      logger.info(
        { parentGid, handle: parentInfo?.handle },
        'theme_sync: parent has no custom template suffix, skipping'
      );
      continue;
    }

    const templateKey = `templates/collection.${parentInfo.templateSuffix}.json`;

    try {
      const readResp = await withTokenRetry(
        shopId,
        encryptionKey,
        logger,
        async (accessToken, shopDomain) => {
          const resp = await fetch(
            `https://${shopDomain}/admin/api/2025-10/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(templateKey)}`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
          );
          return (await resp.json()) as AssetRestResponse;
        }
      );

      if (!readResp.asset?.value) {
        logger.warn({ templateKey }, 'theme_sync: template asset not found');
        continue;
      }

      const tmpl = JSON.parse(readResp.asset.value) as {
        sections?: Record<string, { type?: string; settings?: Record<string, unknown> }>;
      };
      let modified = false;

      for (const op of parentOps) {
        const childInfo = collectionMap.get(op.childCollectionGid);
        if (!childInfo) continue;
        const handle = childInfo.handle;

        for (const section of Object.values(tmpl.sections ?? {})) {
          if (section.type === 'section-collection-list') {
            const cols = section.settings?.['collections'];
            if (Array.isArray(cols)) {
              if (op.action === 'add' && !cols.includes(handle)) {
                cols.push(handle);
                modified = true;
              } else if (op.action === 'remove') {
                const idx = (cols as string[]).indexOf(handle);
                if (idx >= 0) {
                  cols.splice(idx, 1);
                  modified = true;
                }
              }
            }
          }

          if (section.type === 'main-collection') {
            const menu = section.settings?.['collections_menu'];
            if (Array.isArray(menu)) {
              if (op.action === 'add' && !menu.includes(handle)) {
                menu.push(handle);
                modified = true;
              } else if (op.action === 'remove') {
                const idx = (menu as string[]).indexOf(handle);
                if (idx >= 0) {
                  menu.splice(idx, 1);
                  modified = true;
                }
              }
            }
          }
        }
      }

      if (modified) {
        await withTokenRetry(shopId, encryptionKey, logger, async (accessToken, shopDomain) => {
          const resp = await fetch(
            `https://${shopDomain}/admin/api/2025-10/themes/${themeId}/assets.json`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
              },
              body: JSON.stringify({
                asset: { key: templateKey, value: JSON.stringify(tmpl, null, 2) },
              }),
            }
          );
          return (await resp.json()) as AssetRestResponse;
        });
        const childHandles = parentOps.map((o) => collectionMap.get(o.childCollectionGid)?.handle);
        logger.info(
          { templateKey, parent: parentInfo.handle, children: childHandles },
          'theme_sync: updated collection page template'
        );
      }
    } catch (err) {
      logger.warn(
        { err, parentGid, templateKey },
        'theme_sync: failed to update template (non-fatal)'
      );
    }
  }
}

async function processMenuAssign(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
  const menuId = typeof payload.metadata['menuId'] === 'string' ? payload.metadata['menuId'] : null;
  const menuTitle =
    typeof payload.metadata['menuTitle'] === 'string' ? payload.metadata['menuTitle'] : null;

  if (!menuId || !menuTitle) {
    throw new Error('menu_assign_missing_required_metadata');
  }

  const batchedOps = payload.metadata['batchedOperations'] as Record<string, unknown>[] | undefined;

  const operations: MenuOperation[] = batchedOps?.length
    ? batchedOps.map(
        (op): MenuOperation => ({
          action: typeof op['action'] === 'string' ? op['action'] : 'add',
          collectionGid: typeof op['collectionGid'] === 'string' ? op['collectionGid'] : '',
          collectionTitle: typeof op['collectionTitle'] === 'string' ? op['collectionTitle'] : '',
          parentMenuItemId:
            typeof op['parentMenuItemId'] === 'string' ? op['parentMenuItemId'] : undefined,
          menuItemIdToRemove:
            typeof op['menuItemIdToRemove'] === 'string' ? op['menuItemIdToRemove'] : undefined,
        })
      )
    : [
        {
          action:
            typeof payload.metadata['action'] === 'string' ? payload.metadata['action'] : 'add',
          collectionGid:
            typeof payload.metadata['collectionGid'] === 'string'
              ? payload.metadata['collectionGid']
              : '',
          collectionTitle:
            typeof payload.metadata['collectionTitle'] === 'string'
              ? payload.metadata['collectionTitle']
              : '',
          parentMenuItemId:
            typeof payload.metadata['parentMenuItemId'] === 'string'
              ? payload.metadata['parentMenuItemId']
              : undefined,
          menuItemIdToRemove:
            typeof payload.metadata['menuItemIdToRemove'] === 'string'
              ? payload.metadata['menuItemIdToRemove']
              : undefined,
        },
      ];

  const query = `#graphql
    query GetMenuForSync($id: ID!) {
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

  const response = await withTokenRetry(
    payload.shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<MenuQueryResponse>(query, { id: menuId });
    }
  );
  const menu = response.data?.menu;
  if (!menu) {
    throw new Error('menu_assign_menu_not_found');
  }

  const items = (menu.items ?? []).map(toMenuUpdateInput);

  const themeOps = collectThemeOps(items, operations);

  const softErrors: string[] = [];

  for (const op of operations) {
    if (!op.collectionGid || !op.collectionTitle) {
      softErrors.push(`missing_gid_or_title:${op.action}`);
      continue;
    }
    try {
      applyMenuOperation(items, op, logger);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_op_error';
      if (op.action === 'remove' && msg === 'menu_assign_remove_item_not_found') {
        logger.warn({ op }, 'menu_assign: remove target not found, skipping');
        softErrors.push(msg);
      } else {
        throw err;
      }
    }
  }

  validateMenuDepth(items, 1);

  const mutation = `#graphql
    mutation MenuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, items: $items) {
        userErrors {
          message
        }
      }
    }`;

  const updateResponse = await withTokenRetry(
    payload.shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<MenuUpdateResponse>(mutation, {
        id: menu.id,
        title: menu.title,
        items,
      });
    }
  );

  const userErrors = updateResponse.data?.menuUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join('; ') || 'menu_update_failed'
    );
  }

  if (themeOps.length > 0) {
    try {
      await syncThemeCollectionLists(payload.shopId, themeOps, encryptionKey, logger);
    } catch (err) {
      logger.warn({ err }, 'theme_sync: failed (non-fatal, menu was updated successfully)');
    }
  }

  if (softErrors.length > 0) {
    logger.warn({ softErrors }, 'menu_assign: some operations had non-fatal issues');
  }
}

function applyMenuOperation(items: MenuUpdateInput[], op: MenuOperation, logger: Logger): void {
  switch (op.action) {
    case 'add': {
      if (!op.parentMenuItemId) {
        throw new Error('menu_assign_parent_missing');
      }
      const parent = findMenuNodeById(items, op.parentMenuItemId);
      if (!parent) {
        throw new Error('menu_assign_parent_not_found');
      }
      parent.items ??= [];
      parent.items.push({
        title: op.collectionTitle,
        type: 'COLLECTION',
        resourceId: op.collectionGid,
        items: [],
      });
      logger.info(
        { title: op.collectionTitle, parent: parent.title },
        'menu_assign: added collection'
      );
      break;
    }
    case 'move': {
      if (!op.parentMenuItemId) {
        throw new Error('menu_assign_move_parent_missing');
      }
      const removed = removeMenuNodeByResourceId(items, op.collectionGid);
      if (!removed) {
        throw new Error('menu_assign_existing_item_not_found');
      }
      const parent = findMenuNodeById(items, op.parentMenuItemId);
      if (!parent) {
        throw new Error('menu_assign_move_parent_not_found');
      }
      parent.items ??= [];
      parent.items.push(removed);
      break;
    }
    case 'remove': {
      const removed =
        (op.menuItemIdToRemove ? removeMenuNodeById(items, op.menuItemIdToRemove) : null) ??
        removeMenuNodeByResourceId(items, op.collectionGid);
      if (!removed) {
        throw new Error('menu_assign_remove_item_not_found');
      }
      logger.info({ title: removed.title }, 'menu_assign: removed collection');
      break;
    }
    default:
      throw new Error(`unsupported_menu_assign_action:${op.action}`);
  }
}

function toMenuUpdateInput(node: MenuNode): MenuUpdateInput {
  return {
    id: node.id,
    title: node.title,
    type: node.type,
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.url ? { url: node.url } : {}),
    ...(node.tags ? { tags: [...node.tags] } : {}),
    items: (node.items ?? []).map(toMenuUpdateInput),
  };
}

function findMenuNodeById(nodes: MenuUpdateInput[], targetId: string): MenuUpdateInput | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    const child = node.items ? findMenuNodeById(node.items, targetId) : null;
    if (child) return child;
  }
  return null;
}

function removeMenuNodeById(nodes: MenuUpdateInput[], targetId: string): MenuUpdateInput | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.id === targetId) {
      nodes.splice(index, 1);
      return node;
    }
    if (node.items) {
      const child = removeMenuNodeById(node.items, targetId);
      if (child) return child;
    }
  }
  return null;
}

function removeMenuNodeByResourceId(
  nodes: MenuUpdateInput[],
  resourceId: string
): MenuUpdateInput | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.resourceId === resourceId) {
      nodes.splice(index, 1);
      return node;
    }
    if (node.items) {
      const child = removeMenuNodeByResourceId(node.items, resourceId);
      if (child) return child;
    }
  }
  return null;
}

function validateMenuDepth(nodes: MenuUpdateInput[], depth: number): void {
  if (depth > 3) {
    throw new Error('menu_assign_depth_exceeded');
  }
  for (const node of nodes) {
    if (node.items?.length) {
      validateMenuDepth(node.items, depth + 1);
    }
  }
}

type CollectionRemoveProductsResponse = Readonly<{
  collectionRemoveProducts?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

type TagsRemoveResponse = Readonly<{
  tagsRemove?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

async function processProductDissociate(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const productGids = payload.metadata['productGids'] as string[] | undefined;
  const collectionGid = payload.metadata['collectionGid'] as string | undefined;

  if (!productGids?.length || !collectionGid) {
    throw new Error('product_dissociate: missing productGids or collectionGid in metadata');
  }

  const collection = await withTenantContext(payload.shopId, async (client) => {
    const result = await client.query<{
      collection_type: string;
      rules: { column: string; relation: string; condition: string }[] | null;
    }>(
      `SELECT collection_type, rules FROM shopify_collections
        WHERE shop_id = $1 AND shopify_gid = $2 LIMIT 1`,
      [payload.shopId, collectionGid]
    );
    return result.rows[0] ?? null;
  });

  if (!collection) {
    throw new Error('product_dissociate: collection not found in local DB');
  }

  if (collection.collection_type === 'SMART') {
    await processSmartCollectionDissociate(
      payload.shopId,
      productGids,
      collection.rules,
      encryptionKey,
      logger
    );
  } else {
    await processCustomCollectionDissociate(
      payload.shopId,
      collectionGid,
      productGids,
      encryptionKey,
      logger
    );
  }
}

const SHOPIFY_TAGS_REMOVE_BATCH = 250;

async function processSmartCollectionDissociate(
  shopId: string,
  productGids: string[],
  rules: { column: string; relation: string; condition: string }[] | null,
  encryptionKey: Buffer,
  logger: Logger
): Promise<void> {
  const tagRules = (rules ?? []).filter((r) => r.column.toLowerCase() === 'tag');
  if (tagRules.length === 0) {
    throw new Error(
      'product_dissociate: SMART collection has no tag rules — cannot auto-remove products'
    );
  }

  const tagsToRemove = tagRules.map((r) => r.condition);
  logger.info(
    { productCount: productGids.length, tagsToRemove },
    'product_dissociate: removing tags from products (SMART collection)'
  );

  const mutation = `#graphql
    mutation TagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        userErrors {
          message
        }
      }
    }`;

  let successCount = 0;
  let errorCount = 0;
  const succeededGids: string[] = [];

  for (let i = 0; i < productGids.length; i += SHOPIFY_TAGS_REMOVE_BATCH) {
    const batch = productGids.slice(i, i + SHOPIFY_TAGS_REMOVE_BATCH);

    for (const productGid of batch) {
      try {
        const response = await withTokenRetry(
          shopId,
          encryptionKey,
          logger,
          async (accessToken, shopDomain) => {
            const client = shopifyApi.createClient({ shopDomain, accessToken });
            return await client.request<TagsRemoveResponse>(mutation, {
              id: productGid,
              tags: tagsToRemove,
            });
          }
        );

        const userErrors = response.data?.tagsRemove?.userErrors ?? [];
        if (userErrors.length > 0) {
          logger.warn(
            { productGid, errors: userErrors },
            'product_dissociate: tagsRemove userErrors'
          );
          errorCount += 1;
        } else {
          successCount += 1;
          succeededGids.push(productGid);
        }
      } catch (err) {
        logger.warn({ err, productGid }, 'product_dissociate: tagsRemove failed for product');
        errorCount += 1;
      }
    }

    if (i + SHOPIFY_TAGS_REMOVE_BATCH < productGids.length) {
      logger.info(
        { processed: i + batch.length, total: productGids.length },
        'product_dissociate: batch progress'
      );
    }
  }

  logger.info(
    { successCount, errorCount, total: productGids.length },
    'product_dissociate: finished removing tags from products'
  );

  if (errorCount > 0 && successCount === 0) {
    throw new Error(`product_dissociate: all ${errorCount} tagsRemove calls failed`);
  }

  if (succeededGids.length > 0) {
    try {
      await withTenantContext(shopId, async (client) => {
        await client.query(
          `UPDATE shopify_products
              SET tags = (
                SELECT COALESCE(array_agg(t ORDER BY t), '{}')
                FROM unnest(tags) AS t
                WHERE t <> ALL($2::text[])
              ),
              updated_at = now()
            WHERE shop_id = $1
              AND shopify_gid = ANY($3::text[])`,
          [shopId, tagsToRemove, succeededGids]
        );
      });
      logger.info(
        { count: succeededGids.length, tagsToRemove },
        'product_dissociate: updated local product tags'
      );
    } catch (err) {
      logger.warn(
        { err, count: succeededGids.length },
        'product_dissociate: failed to update local tags (Shopify tags were removed successfully)'
      );
    }
  }
}

async function processCustomCollectionDissociate(
  shopId: string,
  collectionGid: string,
  productGids: string[],
  encryptionKey: Buffer,
  logger: Logger
): Promise<void> {
  logger.info(
    { collectionGid, productCount: productGids.length },
    'product_dissociate: removing products from CUSTOM collection in Shopify'
  );

  const mutation = `#graphql
    mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
      collectionRemoveProducts(id: $id, productIds: $productIds) {
        userErrors {
          message
        }
      }
    }`;

  const response = await withTokenRetry(
    shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<CollectionRemoveProductsResponse>(mutation, {
        id: collectionGid,
        productIds: productGids,
      });
    }
  );

  const userErrors = response.data?.collectionRemoveProducts?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join('; ') || 'collection_remove_products_failed'
    );
  }

  logger.info(
    { collectionGid, productCount: productGids.length },
    'product_dissociate: successfully removed products from Shopify collection'
  );
}

// ─── Metafield Definition Create ──────────────────────────────────────────────

type MetafieldDefinitionCreateResponse = Readonly<{
  metafieldDefinitionCreate?: Readonly<{
    createdDefinition?: Readonly<{ id: string }> | null;
    userErrors?:
      | readonly Readonly<{
          field?: readonly string[] | null;
          message?: string | null;
          code?: string | null;
        }>[]
      | null;
  }> | null;
}>;

type MetafieldDefinitionsQueryResponse = Readonly<{
  metafieldDefinitions?: Readonly<{
    nodes?: readonly Readonly<{ id: string; name: string }>[] | null;
  }> | null;
}>;

interface MetafieldDefinitionInput {
  attr_code: string;
  shopify_key: string;
  shopify_type: string;
  display_name_ro: string;
  display_name_en?: string;
  description?: string;
  is_required?: boolean;
}

async function processMetafieldDefinitionCreate(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const rawMetafields = payload.metadata['metafields'];
  if (!Array.isArray(rawMetafields) || rawMetafields.length === 0) {
    throw new Error('metafield_definition_create_missing_metafields');
  }

  const metafields = rawMetafields as MetafieldDefinitionInput[];

  const createMutation = `#graphql
    mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
        }
        userErrors {
          field
          message
          code
        }
      }
    }`;

  const queryExistingMutation = `#graphql
    query MetafieldDefinitionsByKey($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!) {
      metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: $ownerType) {
        nodes {
          id
          name
        }
      }
    }`;

  for (const mf of metafields) {
    const namespace = 'custom';
    const key = mf.shopify_key ?? mf.attr_code;

    // 1. Verificăm în registrul local dacă există deja cu GID
    const existing = await withTenantContext(payload.shopId, async (client) => {
      const r = await client.query<{ shopify_definition_gid: string | null }>(
        `SELECT shopify_definition_gid
           FROM shopify_metafield_definitions
          WHERE shop_id = $1 AND namespace = $2 AND key = $3 AND owner_type = 'PRODUCT'
          LIMIT 1`,
        [payload.shopId, namespace, key]
      );
      return r.rows[0] ?? null;
    });

    if (existing?.shopify_definition_gid) {
      logger.info(
        { key, gid: existing.shopify_definition_gid },
        'metafield_definition_create: already exists in registry, SKIP'
      );
      continue;
    }

    // 2. Creăm în Shopify
    let definitionGid: string | null = null;

    try {
      const response = await withTokenRetry(
        payload.shopId,
        encryptionKey,
        logger,
        async (accessToken, shopDomain) => {
          const client = shopifyApi.createClient({ shopDomain, accessToken });
          return await client.request<MetafieldDefinitionCreateResponse>(createMutation, {
            definition: {
              namespace,
              key,
              name: mf.display_name_ro ?? mf.attr_code,
              description: mf.description ?? '',
              type: mf.shopify_type,
              ownerType: 'PRODUCT',
              capabilities: {
                smartCollectionCondition: { enabled: true },
              },
            },
          });
        }
      );

      const createErrors = response.data?.metafieldDefinitionCreate?.userErrors ?? [];
      const takenError = createErrors.find(
        (e) => e.code === 'TAKEN' || (e.message ?? '').includes('TAKEN')
      );

      if (takenError) {
        // 3. Dacă TAKEN: interogăm Shopify pentru GID-ul existent
        logger.info({ key }, 'metafield_definition_create: TAKEN, querying existing definition');
        const queryResponse = await withTokenRetry(
          payload.shopId,
          encryptionKey,
          logger,
          async (accessToken, shopDomain) => {
            const client = shopifyApi.createClient({ shopDomain, accessToken });
            return await client.request<MetafieldDefinitionsQueryResponse>(queryExistingMutation, {
              namespace,
              key,
              ownerType: 'PRODUCT',
            });
          }
        );
        const nodes = queryResponse.data?.metafieldDefinitions?.nodes ?? [];
        definitionGid = nodes[0]?.id ?? null;
        if (!definitionGid) {
          logger.warn(
            { key },
            'metafield_definition_create: TAKEN but could not fetch existing GID'
          );
        }
      } else if (createErrors.length > 0) {
        const errMsg = createErrors
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ');
        logger.warn(
          { key, errors: errMsg },
          'metafield_definition_create: non-TAKEN error, skipping'
        );
        continue;
      } else {
        definitionGid = response.data?.metafieldDefinitionCreate?.createdDefinition?.id ?? null;
      }
    } catch (err) {
      logger.warn({ key, err }, 'metafield_definition_create: error creating definition, skipping');
      continue;
    }

    // 4. Upsert în registrul local
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `INSERT INTO shopify_metafield_definitions
           (shop_id, namespace, key, shopify_type, name, description, owner_type, use_as_filter, shopify_definition_gid, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PRODUCT', true, $7, now())
         ON CONFLICT (shop_id, namespace, key, owner_type) DO UPDATE
           SET shopify_type           = EXCLUDED.shopify_type,
               name                   = EXCLUDED.name,
               description            = EXCLUDED.description,
               shopify_definition_gid = EXCLUDED.shopify_definition_gid,
               synced_at              = now()`,
        [
          payload.shopId,
          namespace,
          key,
          mf.shopify_type,
          mf.display_name_ro ?? mf.attr_code,
          mf.description ?? null,
          definitionGid,
        ]
      );
    });

    logger.info(
      { key, definitionGid, shopifyType: mf.shopify_type },
      'metafield_definition_create: definition upserted in registry'
    );
  }

  logger.info(
    { collectionId: payload.collectionId, count: metafields.length },
    'metafield_definition_create: all definitions processed'
  );
}
