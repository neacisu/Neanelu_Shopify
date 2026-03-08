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
      default:
        throw new Error(`unsupported_collection_change_type:${String(payload.changeType)}`);
    }
    await markPendingCollectionChangeSynced(payload.shopId, payload.changeId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'collection_shopify_sync_failed';
    await markPendingCollectionChangeFailed(payload.shopId, payload.changeId, message);
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

async function processMenuAssign(
  payload: CollectionShopifySyncJobData,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
  const menuId = typeof payload.metadata['menuId'] === 'string' ? payload.metadata['menuId'] : null;
  const menuTitle =
    typeof payload.metadata['menuTitle'] === 'string' ? payload.metadata['menuTitle'] : null;
  const action =
    typeof payload.metadata['action'] === 'string' ? payload.metadata['action'] : 'add';
  const collectionGid =
    typeof payload.metadata['collectionGid'] === 'string'
      ? payload.metadata['collectionGid']
      : null;
  const collectionTitle =
    typeof payload.metadata['collectionTitle'] === 'string'
      ? payload.metadata['collectionTitle']
      : null;
  const parentMenuItemId =
    typeof payload.metadata['parentMenuItemId'] === 'string'
      ? payload.metadata['parentMenuItemId']
      : null;
  const menuItemIdToRemove =
    typeof payload.metadata['menuItemIdToRemove'] === 'string'
      ? payload.metadata['menuItemIdToRemove']
      : null;

  if (!menuId || !menuTitle || !collectionGid || !collectionTitle) {
    throw new Error('menu_assign_missing_required_metadata');
  }

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

  switch (action) {
    case 'add': {
      if (!parentMenuItemId) {
        throw new Error('menu_assign_parent_missing');
      }
      const parent = findMenuNodeById(items, parentMenuItemId);
      if (!parent) {
        throw new Error('menu_assign_parent_not_found');
      }
      parent.items ??= [];
      parent.items.push({
        title: collectionTitle,
        type: 'COLLECTION',
        resourceId: collectionGid,
        items: [],
      });
      break;
    }
    case 'move': {
      if (!parentMenuItemId) {
        throw new Error('menu_assign_move_parent_missing');
      }
      const removed = removeMenuNodeByResourceId(items, collectionGid);
      if (!removed) {
        throw new Error('menu_assign_existing_item_not_found');
      }
      const parent = findMenuNodeById(items, parentMenuItemId);
      if (!parent) {
        throw new Error('menu_assign_move_parent_not_found');
      }
      parent.items ??= [];
      parent.items.push(removed);
      break;
    }
    case 'remove': {
      const removed =
        (menuItemIdToRemove ? removeMenuNodeById(items, menuItemIdToRemove) : null) ??
        removeMenuNodeByResourceId(items, collectionGid);
      if (!removed) {
        throw new Error('menu_assign_remove_item_not_found');
      }
      break;
    }
    default:
      throw new Error(`unsupported_menu_assign_action:${action}`);
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
