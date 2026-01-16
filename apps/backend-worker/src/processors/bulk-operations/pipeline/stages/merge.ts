import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';

import { recordDbQuery } from '../../../../otel/metrics.js';

function normalizeNullTimestampExpr(jsonExpr: string): string {
  // Avoid casting empty strings.
  return `NULLIF(${jsonExpr}, '')::timestamptz`;
}

export async function runMergeFromStaging(params: {
  shopId: string;
  bulkRunId: string;
  logger: Logger;
  analyze: boolean;
  allowDeletes: boolean;
  isFullSnapshot: boolean;
  reindexStaging: boolean;
}): Promise<void> {
  const started = Date.now();
  try {
    await withTenantContext(params.shopId, async (client) => {
      // Products upsert
      await client.query(
        `INSERT INTO shopify_products (
           shop_id,
           shopify_gid,
           legacy_resource_id,
           title,
           handle,
           vendor,
           product_type,
           status,
           tags,
           created_at_shopify,
           updated_at_shopify,
           synced_at,
           created_at,
           updated_at
         )
         SELECT
           sp.shop_id,
           sp.shopify_gid,
           sp.legacy_resource_id,
           sp.title,
           sp.handle,
           sp.vendor,
           sp.product_type,
           COALESCE(sp.status, 'ACTIVE'),
           COALESCE(sp.tags, '{}'::text[]),
           ${normalizeNullTimestampExpr("sp.raw_data->>'createdAt'")},
           ${normalizeNullTimestampExpr("sp.raw_data->>'updatedAt'")},
           now(),
           now(),
           now()
         FROM staging_products sp
         WHERE sp.bulk_run_id = $1
           AND sp.shop_id = $2
           AND sp.validation_status = 'valid'
           AND sp.merge_status = 'pending'
           AND sp.shopify_gid IS NOT NULL
           AND sp.legacy_resource_id IS NOT NULL
           AND sp.title IS NOT NULL
           AND sp.handle IS NOT NULL
         ON CONFLICT (shop_id, shopify_gid)
         DO UPDATE SET
           legacy_resource_id = EXCLUDED.legacy_resource_id,
           title = EXCLUDED.title,
           handle = EXCLUDED.handle,
           vendor = EXCLUDED.vendor,
           product_type = EXCLUDED.product_type,
           status = EXCLUDED.status,
           tags = EXCLUDED.tags,
           created_at_shopify = COALESCE(EXCLUDED.created_at_shopify, shopify_products.created_at_shopify),
           updated_at_shopify = COALESCE(EXCLUDED.updated_at_shopify, shopify_products.updated_at_shopify),
           synced_at = now(),
           updated_at = now()`,
        [params.bulkRunId, params.shopId]
      );

      // Mark staged products as merged
      await client.query(
        `UPDATE staging_products sp
         SET merge_status = 'merged',
             merged_at = now(),
             target_product_id = p.id
         FROM shopify_products p
         WHERE sp.bulk_run_id = $1
           AND sp.shop_id = $2
           AND sp.validation_status = 'valid'
           AND sp.shopify_gid IS NOT NULL
           AND p.shop_id = sp.shop_id
           AND p.shopify_gid = sp.shopify_gid`,
        [params.bulkRunId, params.shopId]
      );

      // Variants upsert (requires product resolution)
      await client.query(
        `WITH src AS (
           SELECT
             sv.shop_id,
             sv.shopify_gid,
             sv.legacy_resource_id,
             sv.title,
             sv.sku,
             sv.barcode,
             sv.price,
             COALESCE(sv.compare_at_price, sv.price) AS compare_at_price,
             sv.inventory_quantity,
             sv.inventory_item_id,
             COALESCE(sv.selected_options, '[]'::jsonb) AS selected_options,
             sv.raw_data,
             p.id AS product_id,
             ${normalizeNullTimestampExpr("sv.raw_data->>'createdAt'")} AS created_at_shopify,
             ${normalizeNullTimestampExpr("sv.raw_data->>'updatedAt'")} AS updated_at_shopify
           FROM staging_variants sv
           JOIN shopify_products p
             ON p.shop_id = sv.shop_id
            AND p.shopify_gid = COALESCE(
              sv.raw_data->>'__parentId',
              sv.raw_data#>>'{product,id}'
            )
           WHERE sv.bulk_run_id = $1
             AND sv.shop_id = $2
             AND sv.validation_status = 'valid'
             AND sv.merge_status = 'pending'
             AND sv.shopify_gid IS NOT NULL
             AND sv.legacy_resource_id IS NOT NULL
             AND sv.title IS NOT NULL
             AND sv.price IS NOT NULL
         )
         INSERT INTO shopify_variants (
           shop_id,
           product_id,
           shopify_gid,
           legacy_resource_id,
           title,
           sku,
           barcode,
           price,
           compare_at_price,
           inventory_quantity,
           inventory_item_id,
           selected_options,
           created_at_shopify,
           updated_at_shopify,
           synced_at,
           created_at,
           updated_at
         )
         SELECT
           src.shop_id,
           src.product_id,
           src.shopify_gid,
           src.legacy_resource_id,
           src.title,
           src.sku,
           src.barcode,
           src.price,
           src.compare_at_price,
           COALESCE(src.inventory_quantity, 0),
           src.inventory_item_id,
           src.selected_options,
           src.created_at_shopify,
           src.updated_at_shopify,
           now(),
           now(),
           now()
         FROM src
         ON CONFLICT (shop_id, shopify_gid)
         DO UPDATE SET
           product_id = EXCLUDED.product_id,
           legacy_resource_id = EXCLUDED.legacy_resource_id,
           title = EXCLUDED.title,
           sku = EXCLUDED.sku,
           barcode = EXCLUDED.barcode,
           price = EXCLUDED.price,
           compare_at_price = EXCLUDED.compare_at_price,
           inventory_quantity = EXCLUDED.inventory_quantity,
           inventory_item_id = EXCLUDED.inventory_item_id,
           selected_options = EXCLUDED.selected_options,
           created_at_shopify = COALESCE(EXCLUDED.created_at_shopify, shopify_variants.created_at_shopify),
           updated_at_shopify = COALESCE(EXCLUDED.updated_at_shopify, shopify_variants.updated_at_shopify),
           synced_at = now(),
           updated_at = now()`,
        [params.bulkRunId, params.shopId]
      );

      await client.query(
        `UPDATE staging_variants sv
         SET merge_status = 'merged',
             merged_at = now(),
             target_variant_id = v.id
         FROM shopify_variants v
         WHERE sv.bulk_run_id = $1
           AND sv.shop_id = $2
           AND sv.validation_status = 'valid'
           AND sv.shopify_gid IS NOT NULL
           AND v.shop_id = sv.shop_id
           AND v.shopify_gid = sv.shopify_gid`,
        [params.bulkRunId, params.shopId]
      );

      // Deletes (hard delete) are gated by a full snapshot boundary.
      if (params.allowDeletes && params.isFullSnapshot) {
        // Delete variants missing from the snapshot (for products that exist in snapshot).
        await client.query(
          `DELETE FROM shopify_variants v
           USING shopify_products p
           JOIN staging_products sp
             ON sp.bulk_run_id = $1
            AND sp.shop_id = $2
            AND sp.validation_status = 'valid'
            AND sp.shopify_gid = p.shopify_gid
           WHERE v.shop_id = $2
             AND p.shop_id = $2
             AND v.product_id = p.id
             AND NOT EXISTS (
               SELECT 1
               FROM staging_variants sv
               WHERE sv.bulk_run_id = $1
                 AND sv.shop_id = $2
                 AND sv.validation_status = 'valid'
                 AND sv.shopify_gid = v.shopify_gid
             )`,
          [params.bulkRunId, params.shopId]
        );

        // Delete products missing from the snapshot (cascades to variants).
        await client.query(
          `DELETE FROM shopify_products p
           WHERE p.shop_id = $2
             AND NOT EXISTS (
               SELECT 1
               FROM staging_products sp
               WHERE sp.bulk_run_id = $1
                 AND sp.shop_id = $2
                 AND sp.validation_status = 'valid'
                 AND sp.shopify_gid = p.shopify_gid
             )`,
          [params.bulkRunId, params.shopId]
        );
      }

      if (params.analyze) {
        // Keep it best-effort; ANALYZE improves planner stats after heavy upserts.
        await client.query('ANALYZE shopify_products');
        await client.query('ANALYZE shopify_variants');
      }

      if (params.reindexStaging) {
        // REINDEX staging tables post-merge (best-effort, may be heavy on large runs).
        try {
          await client.query('REINDEX TABLE staging_products');
          await client.query('REINDEX TABLE staging_variants');
        } catch {
          // Best-effort only; do not fail the merge for reindex errors.
        }
      }
    });
  } finally {
    // Merge is a mix of inserts/updates/deletes; track under 'update' to fit metrics cardinality.
    recordDbQuery('update', (Date.now() - started) / 1000);
    params.logger.info(
      {
        shopId: params.shopId,
        bulkRunId: params.bulkRunId,
        allowDeletes: params.allowDeletes,
        isFullSnapshot: params.isFullSnapshot,
        analyze: params.analyze,
        reindexStaging: params.reindexStaging,
      },
      'Staging merge completed'
    );
  }
}
