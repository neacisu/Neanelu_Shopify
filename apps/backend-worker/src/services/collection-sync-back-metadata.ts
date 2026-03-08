import { withTenantContext } from '@app/database';
import { loadCollectionMetafieldsForPush } from '../processors/pim/collection-metafield-push.worker.js';
import { loadCollectionMetafieldsToDelete } from './collection-metafields-delete.js';

export async function buildTaxonomyAssignPendingMetadata(params: {
  shopId: string;
  collectionId: string;
  taxonomyId: string;
  previousTaxonomyId?: string | null;
  previousTaxonomyName?: string | null;
}): Promise<Record<string, unknown>> {
  const [taxonomyRow, collectionData] = await Promise.all([
    withTenantContext(params.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        name: string;
        shopify_taxonomy_id: string | null;
      }>(
        `SELECT id, name, shopify_taxonomy_id
           FROM prod_taxonomy
          WHERE id = $1
          LIMIT 1`,
        [params.taxonomyId]
      );
      return result.rows[0] ?? null;
    }),
    loadCollectionMetafieldsForPush({
      shopId: params.shopId,
      collectionId: params.collectionId,
    }),
  ]);

  return {
    taxonomyId: params.taxonomyId,
    taxonomyName: taxonomyRow?.name ?? null,
    shopifyTaxonomyId: taxonomyRow?.shopify_taxonomy_id ?? null,
    previousTaxonomyId: params.previousTaxonomyId ?? null,
    previousTaxonomyName: params.previousTaxonomyName ?? null,
    metafields: collectionData.metafields.map((metafield) => ({
      namespace: metafield.namespace,
      key: metafield.key,
      type: metafield.type,
      value: metafield.value,
    })),
    metafieldCount: collectionData.metafields.length,
  };
}

export async function buildTaxonomyUnassignPendingMetadata(params: {
  shopId: string;
  collectionId: string;
  taxonomyId: string;
  taxonomyName?: string | null;
}): Promise<Record<string, unknown>> {
  const identifiers = await loadCollectionMetafieldsToDelete({
    shopId: params.shopId,
    collectionId: params.collectionId,
    taxonomyId: params.taxonomyId,
  });

  return {
    taxonomyId: params.taxonomyId,
    taxonomyName: params.taxonomyName ?? null,
    metafieldsToDelete: identifiers,
    metafieldCount: identifiers.length,
  };
}

export async function loadCollectionFieldSnapshot(params: {
  shopId: string;
  collectionId: string;
}): Promise<{
  title: string | null;
  description: string | null;
  titleEn: string | null;
  descriptionEn: string | null;
}> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      title: string | null;
      description: string | null;
      title_en: string | null;
      description_en: string | null;
    }>(
      `SELECT title, description, title_en, description_en
         FROM shopify_collections
        WHERE shop_id = $1
          AND id = $2
        LIMIT 1`,
      [params.shopId, params.collectionId]
    );
    const row = result.rows[0];
    return {
      title: row?.title ?? null,
      description: row?.description ?? null,
      titleEn: row?.title_en ?? null,
      descriptionEn: row?.description_en ?? null,
    };
  });
}

export async function buildMenuAssignPendingMetadata(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
}): Promise<Record<string, unknown> | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const assignmentRes = await client.query<{
      assignment_id: string;
      menu_item_id: string | null;
      proposed_path: string | null;
      target_menu_item_gid: string | null;
      target_menu_path: string | null;
      menu_gid: string | null;
      menu_title: string | null;
      menu_handle: string | null;
      collection_gid: string | null;
      collection_title: string;
    }>(
      `SELECT a.id AS assignment_id,
              a.menu_item_id,
              a.proposed_path,
              mi.shopify_gid AS target_menu_item_gid,
              array_to_string(mi.path, ' > ') AS target_menu_path,
              m.shopify_gid AS menu_gid,
              m.title AS menu_title,
              m.handle AS menu_handle,
              sc.shopify_gid AS collection_gid,
              sc.title AS collection_title
         FROM shopify_collection_menu_assignments a
         JOIN shopify_collections sc
           ON sc.id = a.collection_id
          AND sc.shop_id = a.shop_id
         LEFT JOIN shopify_menu_items mi
           ON mi.id = a.menu_item_id
          AND mi.shop_id = a.shop_id
         LEFT JOIN shopify_menus m
           ON m.id = COALESCE(a.menu_id, mi.menu_id)
          AND m.shop_id = a.shop_id
        WHERE a.shop_id = $1
          AND a.collection_id = $2
          AND a.id = $3
        LIMIT 1`,
      [params.shopId, params.collectionId, params.assignmentId]
    );

    const assignment = assignmentRes.rows[0];
    if (!assignment?.collection_gid) {
      return null;
    }

    let resolvedMenuGid = assignment.menu_gid;
    let resolvedMenuHandle = assignment.menu_handle;
    let resolvedMenuTitle = assignment.menu_title;
    let resolvedTargetMenuItemGid = assignment.target_menu_item_gid;
    let resolvedTargetMenuPath = assignment.target_menu_path;

    if (!resolvedMenuGid && assignment.proposed_path) {
      const primaryMenuRes = await client.query<{
        shopify_gid: string;
        handle: string;
        title: string;
      }>(
        `SELECT shopify_gid, handle, title
           FROM shopify_menus
          WHERE shop_id = $1
            AND handle = 'categorii-produse'
          LIMIT 1`,
        [params.shopId]
      );
      const primaryMenu = primaryMenuRes.rows[0] ?? null;
      if (primaryMenu) {
        resolvedMenuGid = primaryMenu.shopify_gid;
        resolvedMenuHandle = primaryMenu.handle;
        resolvedMenuTitle = primaryMenu.title;
      }

      const segments = assignment.proposed_path
        .split('>')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      const parentSegments = segments.slice(0, -1);
      if (parentSegments.length > 0) {
        const parentRes = await client.query<{
          shopify_gid: string;
          parent_path: string | null;
        }>(
          `SELECT shopify_gid, array_to_string(path, ' > ') AS parent_path
             FROM shopify_menu_items
            WHERE shop_id = $1
              AND path = $2::text[]
            LIMIT 1`,
          [params.shopId, parentSegments]
        );
        const parent = parentRes.rows[0] ?? null;
        if (parent) {
          resolvedTargetMenuItemGid = parent.shopify_gid;
          resolvedTargetMenuPath = parent.parent_path;
        }
      }
    }

    const existingMenuItemRes = await client.query<{
      menu_item_gid: string;
      parent_gid: string | null;
      parent_path: string | null;
    }>(
      `SELECT mi.shopify_gid AS menu_item_gid,
              parent.shopify_gid AS parent_gid,
              array_to_string(parent.path, ' > ') AS parent_path
         FROM shopify_menu_items mi
         LEFT JOIN shopify_menu_items parent
           ON parent.id = mi.parent_item_id
          AND parent.shop_id = mi.shop_id
        WHERE mi.shop_id = $1
          AND mi.item_type = 'COLLECTION'
          AND mi.resource_id = $2
        ORDER BY mi.level ASC, mi.position ASC
        LIMIT 1`,
      [params.shopId, assignment.collection_gid]
    );

    const existing = existingMenuItemRes.rows[0] ?? null;
    const action =
      assignment.proposed_path != null
        ? 'add'
        : existing?.parent_gid && assignment.target_menu_item_gid
          ? existing.parent_gid === assignment.target_menu_item_gid
            ? 'add'
            : 'move'
          : assignment.target_menu_item_gid
            ? 'add'
            : 'remove';

    return {
      action,
      assignmentId: assignment.assignment_id,
      menuId: resolvedMenuGid,
      menuHandle: resolvedMenuHandle,
      menuTitle: resolvedMenuTitle,
      parentMenuItemId: resolvedTargetMenuItemGid,
      parentPath: resolvedTargetMenuPath ?? assignment.proposed_path,
      collectionGid: assignment.collection_gid,
      collectionTitle: assignment.collection_title,
      menuItemIdToRemove: existing?.menu_item_gid ?? null,
      previousParentMenuItemId: existing?.parent_gid ?? null,
      previousParentPath: existing?.parent_path ?? null,
      proposedPath: assignment.proposed_path,
    };
  });
}
