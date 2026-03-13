import { withTenantContext } from '@app/database';

export type CollectionPendingChangeType =
  | 'field_update'
  | 'taxonomy_assign'
  | 'taxonomy_unassign'
  | 'menu_assign'
  | 'product_dissociate'
  | 'metafield_definition_create';

export type CollectionPendingChangeSource =
  | 'manual'
  | 'ai_generate'
  | 'ai_translate'
  | 'ai_taxonomy'
  | 'ai_menu'
  | 'ai_metafield'
  | 'sync';

export type CollectionPendingChangeStatus =
  | 'pending'
  | 'approved'
  | 'synced'
  | 'failed'
  | 'rejected';

export type CollectionPendingChangeMutation =
  | 'collectionUpdate'
  | 'collectionRemoveProducts'
  | 'tagsRemove'
  | 'metafieldsSet'
  | 'metafieldsDelete'
  | 'menuUpdate'
  | 'metafieldDefinitionCreate';

type QueryResult<T> = Readonly<{
  rows: T[];
  rowCount: number | null;
}>;

export interface DbClientLike {
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface PendingChangeCounts {
  field_update: number;
  taxonomy_assign: number;
  taxonomy_unassign: number;
  menu_assign: number;
  product_dissociate: number;
  metafield_definition_create: number;
}

export interface CollectionPendingChangeRow {
  id: string;
  collectionId: string;
  collectionTitle: string;
  changeType: CollectionPendingChangeType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown>;
  source: string;
  shopifyMutation: string | null;
  createdAt: string;
}

export interface ApprovedPendingChange {
  id: string;
  shopId: string;
  collectionId: string;
  changeType: CollectionPendingChangeType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown>;
  source: CollectionPendingChangeSource;
  shopifyMutation: CollectionPendingChangeMutation | null;
}

const EMPTY_COUNTS: PendingChangeCounts = {
  field_update: 0,
  taxonomy_assign: 0,
  taxonomy_unassign: 0,
  menu_assign: 0,
  product_dissociate: 0,
  metafield_definition_create: 0,
};

function normalizeMetadata(metadata: Record<string, unknown> | null | undefined): string {
  return JSON.stringify(metadata ?? {});
}

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function mergeCounts(rows: readonly { change_type: string; count: number }[]): PendingChangeCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    if (row.change_type in counts) {
      counts[row.change_type as keyof PendingChangeCounts] = Number(row.count ?? 0);
    }
  }
  return counts;
}

async function findExistingPendingChange(
  client: DbClientLike,
  params:
    | { shopId: string; collectionId: string; changeType: 'field_update'; fieldName: string }
    | { shopId: string; collectionId: string; changeType: 'taxonomy_assign' | 'taxonomy_unassign' }
    | { shopId: string; collectionId: string; changeType: 'menu_assign'; assignmentId: string }
): Promise<{ id: string } | null> {
  if (params.changeType === 'field_update') {
    const result = await client.query<{ id: string }>(
      `SELECT id
         FROM collection_pending_changes
        WHERE shop_id = $1
          AND collection_id = $2
          AND change_type = 'field_update'
          AND field_name = $3
          AND status = 'pending'
        LIMIT 1`,
      [params.shopId, params.collectionId, params.fieldName]
    );
    return result.rows[0] ?? null;
  }

  if (params.changeType === 'menu_assign') {
    const result = await client.query<{ id: string }>(
      `SELECT id
         FROM collection_pending_changes
        WHERE shop_id = $1
          AND collection_id = $2
          AND change_type = 'menu_assign'
          AND status = 'pending'
          AND metadata->>'assignmentId' = $3
        LIMIT 1`,
      [params.shopId, params.collectionId, params.assignmentId]
    );
    return result.rows[0] ?? null;
  }

  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM collection_pending_changes
      WHERE shop_id = $1
        AND collection_id = $2
        AND change_type = $3
        AND status = 'pending'
      LIMIT 1`,
    [params.shopId, params.collectionId, params.changeType]
  );
  return result.rows[0] ?? null;
}

export async function upsertFieldUpdatePendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    fieldName: 'title' | 'description';
    oldValue: string | null;
    newValue: string | null;
    source: CollectionPendingChangeSource;
  }
): Promise<void> {
  const existing = await findExistingPendingChange(client, {
    shopId: params.shopId,
    collectionId: params.collectionId,
    changeType: 'field_update',
    fieldName: params.fieldName,
  });
  if (existing) {
    await client.query(
      `UPDATE collection_pending_changes
          SET old_value = $4,
              new_value = $5,
              source = $6,
              created_at = now(),
              error_message = NULL
        WHERE id = $1
          AND shop_id = $2
          AND collection_id = $3`,
      [
        existing.id,
        params.shopId,
        params.collectionId,
        params.oldValue,
        params.newValue,
        params.source,
      ]
    );
    return;
  }

  await client.query(
    `INSERT INTO collection_pending_changes (
       shop_id,
       collection_id,
       change_type,
       field_name,
       old_value,
       new_value,
       source,
       shopify_mutation
     )
     VALUES ($1, $2, 'field_update', $3, $4, $5, $6, 'collectionUpdate')`,
    [
      params.shopId,
      params.collectionId,
      params.fieldName,
      params.oldValue,
      params.newValue,
      params.source,
    ]
  );
}

async function upsertMetadataPendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    changeType: 'taxonomy_assign' | 'taxonomy_unassign';
    metadata: Record<string, unknown>;
    source: CollectionPendingChangeSource;
    mutation: CollectionPendingChangeMutation;
  }
): Promise<void> {
  const existing = await findExistingPendingChange(client, {
    shopId: params.shopId,
    collectionId: params.collectionId,
    changeType: params.changeType,
  });
  if (existing) {
    await client.query(
      `UPDATE collection_pending_changes
          SET metadata = $4::jsonb,
              source = $5,
              shopify_mutation = $6,
              created_at = now(),
              error_message = NULL
        WHERE id = $1
          AND shop_id = $2
          AND collection_id = $3`,
      [
        existing.id,
        params.shopId,
        params.collectionId,
        normalizeMetadata(params.metadata),
        params.source,
        params.mutation,
      ]
    );
    return;
  }

  await client.query(
    `INSERT INTO collection_pending_changes (
       shop_id,
       collection_id,
       change_type,
       metadata,
       source,
       shopify_mutation
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      params.shopId,
      params.collectionId,
      params.changeType,
      normalizeMetadata(params.metadata),
      params.source,
      params.mutation,
    ]
  );
}

export async function upsertTaxonomyAssignPendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    metadata: Record<string, unknown>;
    source: CollectionPendingChangeSource;
  }
): Promise<void> {
  await upsertMetadataPendingChange(client, {
    ...params,
    changeType: 'taxonomy_assign',
    mutation: 'metafieldsSet',
  });
}

export async function upsertTaxonomyUnassignPendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    metadata: Record<string, unknown>;
    source: CollectionPendingChangeSource;
  }
): Promise<void> {
  await upsertMetadataPendingChange(client, {
    ...params,
    changeType: 'taxonomy_unassign',
    mutation: 'metafieldsDelete',
  });
}

export async function upsertMenuAssignPendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    assignmentId: string;
    metadata: Record<string, unknown>;
    source: CollectionPendingChangeSource;
  }
): Promise<void> {
  const existing = await findExistingPendingChange(client, {
    shopId: params.shopId,
    collectionId: params.collectionId,
    changeType: 'menu_assign',
    assignmentId: params.assignmentId,
  });
  if (existing) {
    await client.query(
      `UPDATE collection_pending_changes
          SET metadata = $4::jsonb,
              source = $5,
              shopify_mutation = 'menuUpdate',
              created_at = now(),
              error_message = NULL
        WHERE id = $1
          AND shop_id = $2
          AND collection_id = $3`,
      [
        existing.id,
        params.shopId,
        params.collectionId,
        normalizeMetadata(params.metadata),
        params.source,
      ]
    );
    return;
  }

  await client.query(
    `INSERT INTO collection_pending_changes (
       shop_id,
       collection_id,
       change_type,
       metadata,
       source,
       shopify_mutation
     )
     VALUES ($1, $2, 'menu_assign', $3::jsonb, $4, 'menuUpdate')`,
    [params.shopId, params.collectionId, normalizeMetadata(params.metadata), params.source]
  );
}

export async function upsertProductDissociatePendingChange(
  client: DbClientLike,
  params: {
    shopId: string;
    collectionId: string;
    productIds: string[];
    productGids: string[];
    collectionGid: string;
    collectionType?: string;
    source: CollectionPendingChangeSource;
  }
): Promise<void> {
  const mutation: CollectionPendingChangeMutation =
    params.collectionType === 'SMART' ? 'tagsRemove' : 'collectionRemoveProducts';
  const metadata = {
    productIds: params.productIds,
    productGids: params.productGids,
    collectionGid: params.collectionGid,
    collectionType: params.collectionType ?? 'CUSTOM',
  };
  await client.query(
    `INSERT INTO collection_pending_changes (
       shop_id,
       collection_id,
       change_type,
       metadata,
       source,
       shopify_mutation
     )
     VALUES ($1, $2, 'product_dissociate', $3::jsonb, $4, $5)`,
    [params.shopId, params.collectionId, normalizeMetadata(metadata), params.source, mutation]
  );
}

export async function listPendingCollectionChanges(
  shopId: string
): Promise<{ changes: CollectionPendingChangeRow[]; byType: PendingChangeCounts }> {
  return await withTenantContext(shopId, async (client) => {
    const [changesResult, countsResult] = await Promise.all([
      client.query<{
        id: string;
        collection_id: string;
        collection_title: string;
        change_type: CollectionPendingChangeType;
        field_name: string | null;
        old_value: string | null;
        new_value: string | null;
        metadata: Record<string, unknown> | null;
        source: string;
        shopify_mutation: string | null;
        created_at: string;
      }>(
        `SELECT cpc.id,
                cpc.collection_id,
                sc.title AS collection_title,
                cpc.change_type,
                cpc.field_name,
                cpc.old_value,
                cpc.new_value,
                cpc.metadata,
                cpc.source,
                cpc.shopify_mutation,
                cpc.created_at::text
           FROM collection_pending_changes cpc
           JOIN shopify_collections sc
             ON sc.id = cpc.collection_id
            AND sc.shop_id = cpc.shop_id
          WHERE cpc.shop_id = $1
            AND cpc.status = 'pending'
          ORDER BY
            CASE cpc.change_type
              WHEN 'taxonomy_unassign' THEN 0
              WHEN 'taxonomy_assign' THEN 1
              WHEN 'field_update' THEN 2
              ELSE 3
            END,
            cpc.created_at DESC`,
        [shopId]
      ),
      client.query<{ change_type: string; count: number }>(
        `SELECT change_type, COUNT(*)::int AS count
           FROM collection_pending_changes
          WHERE shop_id = $1
            AND status = 'pending'
          GROUP BY change_type`,
        [shopId]
      ),
    ]);

    return {
      changes: changesResult.rows.map((row) => ({
        id: row.id,
        collectionId: row.collection_id,
        collectionTitle: row.collection_title,
        changeType: row.change_type,
        fieldName: row.field_name,
        oldValue: row.old_value,
        newValue: row.new_value,
        metadata: parseMetadata(row.metadata),
        source: row.source,
        shopifyMutation: row.shopify_mutation,
        createdAt: row.created_at,
      })),
      byType: mergeCounts(countsResult.rows),
    };
  });
}

export async function getPendingCollectionChangeCounts(shopId: string): Promise<{
  count: number;
  byType: PendingChangeCounts;
}> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ change_type: string; count: number }>(
      `SELECT change_type, COUNT(*)::int AS count
         FROM collection_pending_changes
        WHERE shop_id = $1
          AND status = 'pending'
        GROUP BY change_type`,
      [shopId]
    );
    const byType = mergeCounts(result.rows);
    return {
      count:
        byType.field_update +
        byType.taxonomy_assign +
        byType.taxonomy_unassign +
        byType.menu_assign +
        byType.product_dissociate +
        byType.metafield_definition_create,
      byType,
    };
  });
}

export async function rejectPendingCollectionChange(
  shopId: string,
  changeId: string
): Promise<boolean> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE collection_pending_changes
          SET status = 'rejected',
              error_message = NULL
        WHERE shop_id = $1
          AND id = $2
          AND status = 'pending'
      RETURNING id`,
      [shopId, changeId]
    );
    return (result.rowCount ?? 0) > 0;
  });
}

function sortApprovedChanges(rows: readonly ApprovedPendingChange[]): ApprovedPendingChange[] {
  const order: Record<CollectionPendingChangeType, number> = {
    taxonomy_unassign: 0,
    taxonomy_assign: 1,
    field_update: 2,
    product_dissociate: 3,
    metafield_definition_create: 4,
    menu_assign: 5,
  };
  return [...rows].sort((a, b) => order[a.changeType] - order[b.changeType]);
}

export async function approvePendingCollectionChanges(
  shopId: string
): Promise<ApprovedPendingChange[]> {
  return await withTenantContext(shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await client.query<{
        id: string;
        shop_id: string;
        collection_id: string;
        change_type: CollectionPendingChangeType;
        field_name: string | null;
        old_value: string | null;
        new_value: string | null;
        metadata: Record<string, unknown> | null;
        source: CollectionPendingChangeSource;
        shopify_mutation: CollectionPendingChangeMutation | null;
      }>(
        `SELECT id,
                shop_id,
                collection_id,
                change_type,
                field_name,
                old_value,
                new_value,
                metadata,
                source,
                shopify_mutation
           FROM collection_pending_changes
          WHERE shop_id = $1
            AND status = 'pending'
          ORDER BY created_at ASC`,
        [shopId]
      );
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      const ids = result.rows.map((row) => row.id);
      await client.query(
        `UPDATE collection_pending_changes
            SET status = 'approved',
                approved_at = now(),
                error_message = NULL
          WHERE shop_id = $1
            AND id = ANY($2::uuid[])`,
        [shopId, ids]
      );

      await client.query('COMMIT');

      return sortApprovedChanges(
        result.rows.map((row) => ({
          id: row.id,
          shopId: row.shop_id,
          collectionId: row.collection_id,
          changeType: row.change_type,
          fieldName: row.field_name,
          oldValue: row.old_value,
          newValue: row.new_value,
          metadata: parseMetadata(row.metadata),
          source: row.source,
          shopifyMutation: row.shopify_mutation,
        }))
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function markPendingCollectionChangeSynced(
  shopId: string,
  changeId: string
): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `UPDATE collection_pending_changes
          SET status = 'synced',
              synced_at = now(),
              error_message = NULL
        WHERE shop_id = $1
          AND id = $2`,
      [shopId, changeId]
    );
  });
}

export async function markPendingCollectionChangeFailed(
  shopId: string,
  changeId: string,
  errorMessage: string
): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `UPDATE collection_pending_changes
          SET status = 'failed',
              error_message = $3
        WHERE shop_id = $1
          AND id = $2`,
      [shopId, changeId, errorMessage]
    );
  });
}

export async function invalidatePendingCollectionChanges(
  shopId: string,
  reason = 'Invalidated by Shopify re-sync'
): Promise<number> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE collection_pending_changes
          SET status = 'rejected',
              error_message = $2
        WHERE shop_id = $1
          AND status = 'pending'
      RETURNING id`,
      [shopId, reason]
    );
    return result.rowCount ?? 0;
  });
}
