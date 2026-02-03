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
  statementTimeoutMs?: number;
  logTimings?: boolean;
}): Promise<void> {
  const started = Date.now();
  try {
    await withTenantContext(params.shopId, async (client) => {
      if (typeof params.statementTimeoutMs === 'number') {
        const timeoutMs = Math.max(0, Math.floor(params.statementTimeoutMs));
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      }

      const timed = async (label: string, fn: () => Promise<void>) => {
        const t0 = Date.now();
        if (params.logTimings) {
          params.logger.info({ event: 'merge.step.start', label }, 'merge step start');
        }
        await fn();
        if (params.logTimings) {
          params.logger.info(
            { event: 'merge.step.end', label, durationMs: Date.now() - t0 },
            'merge step end'
          );
        }
      };
      // Media upsert (dedupe staging rows to avoid ON CONFLICT self-collision)
      await timed('media.upsert', async () => {
        await client.query(
          `WITH src AS (
           SELECT DISTINCT ON (sm.shop_id, sm.shopify_gid)
             sm.shop_id,
             sm.shopify_gid,
             sm.legacy_resource_id,
             sm.media_type,
             sm.alt,
             sm.status,
             sm.mime_type,
             sm.file_size,
             sm.width,
             sm.height,
             sm.duration,
             sm.url,
             sm.preview_url,
             sm.sources,
             sm.metadata,
             sm.raw_data,
             sm.imported_at
           FROM staging_media sm
           WHERE sm.bulk_run_id = $1
             AND sm.shop_id = $2
             AND sm.validation_status = 'valid'
             AND sm.merge_status = 'pending'
             AND sm.shopify_gid IS NOT NULL
           ORDER BY sm.shop_id, sm.shopify_gid, sm.imported_at DESC
         )
         INSERT INTO shopify_media (
           shop_id,
           shopify_gid,
           legacy_resource_id,
           media_type,
           alt,
           status,
           mime_type,
           file_size,
           width,
           height,
           duration,
           url,
           preview_url,
           sources,
           metadata,
           created_at_shopify,
           synced_at,
           created_at,
           updated_at
         )
         SELECT
           src.shop_id,
           src.shopify_gid,
           src.legacy_resource_id,
           src.media_type,
           src.alt,
           COALESCE(src.status, 'READY'),
           src.mime_type,
           src.file_size,
           src.width,
           src.height,
           src.duration,
           src.url,
           src.preview_url,
           COALESCE(src.sources, '[]'::jsonb),
           COALESCE(src.metadata, '{}'::jsonb),
           ${normalizeNullTimestampExpr("src.raw_data->>'createdAt'")},
           now(),
           now(),
           now()
         FROM src
         ON CONFLICT (shop_id, shopify_gid)
         DO UPDATE SET
           legacy_resource_id = EXCLUDED.legacy_resource_id,
           media_type = EXCLUDED.media_type,
           alt = EXCLUDED.alt,
           status = EXCLUDED.status,
           mime_type = EXCLUDED.mime_type,
           file_size = EXCLUDED.file_size,
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           duration = EXCLUDED.duration,
           url = EXCLUDED.url,
           preview_url = EXCLUDED.preview_url,
           sources = EXCLUDED.sources,
           metadata = EXCLUDED.metadata,
           created_at_shopify = COALESCE(EXCLUDED.created_at_shopify, shopify_media.created_at_shopify),
           synced_at = now(),
           updated_at = now()`,
          [params.bulkRunId, params.shopId]
        );
      });

      await timed('media.mark-merged', async () => {
        const res = await client.query(
          `UPDATE staging_media sm
           SET merge_status = 'merged',
               merged_at = now(),
               target_media_id = m.media_id
           FROM shopify_media m
           WHERE sm.bulk_run_id = $1
             AND sm.shop_id = $2
             AND sm.validation_status = 'valid'
             AND sm.merge_status = 'pending'
             AND sm.shopify_gid IS NOT NULL
             AND m.shop_id = sm.shop_id
             AND m.shopify_gid = sm.shopify_gid`,
          [params.bulkRunId, params.shopId]
        );

        params.logger.info(
          { label: 'media.mark-merged', totalUpdated: res.rowCount ?? 0 },
          'mark-merged complete'
        );
      });
      // Products upsert (dedupe staging rows to avoid ON CONFLICT self-collision)
      await timed('products.upsert', async () => {
        await client.query(
          `WITH src AS (
           SELECT DISTINCT ON (sp.shop_id, sp.shopify_gid)
             sp.shop_id,
             sp.shopify_gid,
             sp.legacy_resource_id,
             sp.title,
             sp.handle,
             sp.description,
             sp.description_html,
             sp.vendor,
             sp.product_type,
             sp.status,
             sp.tags,
             sp.options,
             sp.seo,
             sp.featured_image_url,
             sp.price_range,
             sp.compare_at_price_range,
             sp.published_at,
             sp.template_suffix,
             sp.has_only_default_variant,
             sp.total_inventory,
             sp.raw_data,
             sp.imported_at
           FROM staging_products sp
           WHERE sp.bulk_run_id = $1
             AND sp.shop_id = $2
             AND sp.validation_status = 'valid'
             AND sp.merge_status = 'pending'
             AND sp.shopify_gid IS NOT NULL
             AND sp.legacy_resource_id IS NOT NULL
             AND sp.title IS NOT NULL
             AND sp.handle IS NOT NULL
           ORDER BY sp.shop_id, sp.shopify_gid, sp.imported_at DESC
         )
         INSERT INTO shopify_products (
           shop_id,
           shopify_gid,
           legacy_resource_id,
           title,
           handle,
           description,
           description_html,
           vendor,
           product_type,
           status,
           tags,
           options,
           seo,
           featured_image_url,
           price_range,
           compare_at_price_range,
           published_at,
           template_suffix,
           has_only_default_variant,
           total_inventory,
           created_at_shopify,
           updated_at_shopify,
           synced_at,
           created_at,
           updated_at
         )
         SELECT
           src.shop_id,
           src.shopify_gid,
           src.legacy_resource_id,
           src.title,
           src.handle,
           src.description,
           src.description_html,
           src.vendor,
           src.product_type,
           COALESCE(src.status, 'ACTIVE'),
           COALESCE(src.tags, '{}'::text[]),
           COALESCE(src.options, '[]'::jsonb),
           src.seo,
           src.featured_image_url,
          src.price_range,
          src.compare_at_price_range,
          src.published_at,
          src.template_suffix,
           COALESCE(src.has_only_default_variant, true),
           src.total_inventory,
           ${normalizeNullTimestampExpr("src.raw_data->>'createdAt'")},
           ${normalizeNullTimestampExpr("src.raw_data->>'updatedAt'")},
           now(),
           now(),
           now()
         FROM src
         ON CONFLICT (shop_id, shopify_gid)
         DO UPDATE SET
           legacy_resource_id = EXCLUDED.legacy_resource_id,
           title = EXCLUDED.title,
           handle = EXCLUDED.handle,
           description = COALESCE(EXCLUDED.description, shopify_products.description),
           description_html = COALESCE(EXCLUDED.description_html, shopify_products.description_html),
           vendor = EXCLUDED.vendor,
           product_type = EXCLUDED.product_type,
           status = EXCLUDED.status,
           tags = EXCLUDED.tags,
           options = EXCLUDED.options,
           seo = COALESCE(EXCLUDED.seo, shopify_products.seo),
           featured_image_url = COALESCE(EXCLUDED.featured_image_url, shopify_products.featured_image_url),
           price_range = COALESCE(EXCLUDED.price_range, shopify_products.price_range),
           compare_at_price_range = COALESCE(
             EXCLUDED.compare_at_price_range,
             shopify_products.compare_at_price_range
           ),
           published_at = COALESCE(EXCLUDED.published_at, shopify_products.published_at),
           template_suffix = COALESCE(EXCLUDED.template_suffix, shopify_products.template_suffix),
           has_only_default_variant = COALESCE(
             EXCLUDED.has_only_default_variant,
             shopify_products.has_only_default_variant
           ),
           total_inventory = COALESCE(EXCLUDED.total_inventory, shopify_products.total_inventory),
           created_at_shopify = COALESCE(EXCLUDED.created_at_shopify, shopify_products.created_at_shopify),
           updated_at_shopify = COALESCE(EXCLUDED.updated_at_shopify, shopify_products.updated_at_shopify),
           synced_at = now(),
           updated_at = now()`,
          [params.bulkRunId, params.shopId]
        );
      });

      // Update statistics after heavy insert to help planner choose optimal join strategy
      await timed('products.analyze', async () => {
        await client.query('ANALYZE shopify_media');
        await client.query('ANALYZE shopify_products');
        await client.query('ANALYZE staging_media');
        await client.query('ANALYZE staging_products');
      });

      // Mark staged products as merged using UPDATE FROM JOIN (most efficient for bulk)
      await timed('products.mark-merged', async () => {
        // Disable nested loop to force hash join - critical for 1M+ rows performance
        // Nested loop would be O(n*m) while hash join is O(n+m)
        await client.query('SET LOCAL enable_nestloop = off');

        // UPDATE FROM with JOIN is significantly faster than correlated subqueries
        // because PostgreSQL can use a single hash/merge join instead of per-row lookups
        const res = await client.query(
          `UPDATE staging_products sp
           SET merge_status = 'merged',
               merged_at = now(),
               target_product_id = p.id
           FROM shopify_products p
           WHERE sp.bulk_run_id = $1
             AND sp.shop_id = $2
             AND sp.validation_status = 'valid'
             AND sp.merge_status = 'pending'
             AND sp.shopify_gid IS NOT NULL
             AND p.shop_id = sp.shop_id
             AND p.shopify_gid = sp.shopify_gid`,
          [params.bulkRunId, params.shopId]
        );

        // Re-enable nested loop for subsequent queries
        await client.query('SET LOCAL enable_nestloop = on');

        params.logger.info(
          { label: 'products.mark-merged', totalUpdated: res.rowCount ?? 0 },
          'mark-merged complete'
        );
      });

      // Product media upsert (requires product + media resolution)
      // Use DISTINCT ON to avoid "cannot affect row a second time" when staging has duplicates
      await timed('product-media.upsert', async () => {
        await client.query(
          `INSERT INTO shopify_product_media (
            shop_id,
            product_id,
            media_id,
            position,
            is_featured,
            created_at,
            updated_at
          )
          SELECT DISTINCT ON (p.id, m.media_id)
            spm.shop_id,
            p.id,
            m.media_id,
            spm.position,
            spm.is_featured,
            now(),
            now()
          FROM staging_product_media spm
          JOIN shopify_products p
            ON p.shop_id = spm.shop_id
           AND p.shopify_gid = spm.product_shopify_gid
          JOIN shopify_media m
            ON m.shop_id = spm.shop_id
           AND m.shopify_gid = spm.media_shopify_gid
          WHERE spm.bulk_run_id = $1
            AND spm.shop_id = $2
            AND spm.validation_status = 'valid'
            AND spm.merge_status = 'pending'
          ORDER BY p.id, m.media_id, spm.imported_at DESC
          ON CONFLICT (product_id, media_id)
          DO UPDATE SET
            position = EXCLUDED.position,
            is_featured = EXCLUDED.is_featured,
            updated_at = now()`,
          [params.bulkRunId, params.shopId]
        );
      });

      await timed('product-media.mark-merged', async () => {
        const res = await client.query(
          `UPDATE staging_product_media spm
           SET merge_status = 'merged',
               merged_at = now()
           WHERE spm.bulk_run_id = $1
             AND spm.shop_id = $2
             AND spm.validation_status = 'valid'
             AND spm.merge_status = 'pending'`,
          [params.bulkRunId, params.shopId]
        );
        params.logger.info(
          { label: 'product-media.mark-merged', totalUpdated: res.rowCount ?? 0 },
          'mark-merged complete'
        );
      });

      // Variants upsert (requires product resolution)
      await timed('variants.upsert', async () => {
        await client.query(
          `WITH src AS (
           SELECT DISTINCT ON (sv.shop_id, sv.shopify_gid)
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
             sv.image_url,
             sv.raw_data,
             sv.imported_at,
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
           ORDER BY sv.shop_id, sv.shopify_gid, sv.imported_at DESC
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
           image_url,
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
           src.image_url,
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
           image_url = COALESCE(EXCLUDED.image_url, shopify_variants.image_url),
           created_at_shopify = COALESCE(EXCLUDED.created_at_shopify, shopify_variants.created_at_shopify),
           updated_at_shopify = COALESCE(EXCLUDED.updated_at_shopify, shopify_variants.updated_at_shopify),
           synced_at = now(),
           updated_at = now()`,
          [params.bulkRunId, params.shopId]
        );
      });

      // Use DISTINCT ON to avoid "cannot affect row a second time" when staging has duplicates
      await timed('variant-media.upsert', async () => {
        await client.query(
          `INSERT INTO shopify_variant_media (
            shop_id,
            variant_id,
            media_id,
            position,
            created_at,
            updated_at
          )
          SELECT DISTINCT ON (v.id, m.media_id)
            svm.shop_id,
            v.id,
            m.media_id,
            svm.position,
            now(),
            now()
          FROM staging_variant_media svm
          JOIN shopify_variants v
            ON v.shop_id = svm.shop_id
           AND v.shopify_gid = svm.variant_shopify_gid
          JOIN shopify_media m
            ON m.shop_id = svm.shop_id
           AND m.shopify_gid = svm.media_shopify_gid
          WHERE svm.bulk_run_id = $1
            AND svm.shop_id = $2
            AND svm.validation_status = 'valid'
            AND svm.merge_status = 'pending'
          ORDER BY v.id, m.media_id, svm.imported_at DESC
          ON CONFLICT (variant_id, media_id)
          DO UPDATE SET
            position = EXCLUDED.position,
            updated_at = now()`,
          [params.bulkRunId, params.shopId]
        );
      });

      await timed('variant-media.mark-merged', async () => {
        const res = await client.query(
          `UPDATE staging_variant_media svm
           SET merge_status = 'merged',
               merged_at = now()
           WHERE svm.bulk_run_id = $1
             AND svm.shop_id = $2
             AND svm.validation_status = 'valid'
             AND svm.merge_status = 'pending'`,
          [params.bulkRunId, params.shopId]
        );
        params.logger.info(
          { label: 'variant-media.mark-merged', totalUpdated: res.rowCount ?? 0 },
          'mark-merged complete'
        );
      });

      // Update statistics after heavy insert to help planner choose optimal join strategy
      await timed('variants.analyze', async () => {
        await client.query('ANALYZE shopify_variants');
        await client.query('ANALYZE staging_variants');
      });

      await timed('variants.mark-merged', async () => {
        // Disable nested loop to force hash join - critical for 1M+ rows performance
        await client.query('SET LOCAL enable_nestloop = off');

        // UPDATE FROM with JOIN - same optimization as products.mark-merged
        const res = await client.query(
          `UPDATE staging_variants sv
           SET merge_status = 'merged',
               merged_at = now(),
               target_variant_id = v.id
           FROM shopify_variants v
           WHERE sv.bulk_run_id = $1
             AND sv.shop_id = $2
             AND sv.validation_status = 'valid'
             AND sv.merge_status = 'pending'
             AND sv.shopify_gid IS NOT NULL
             AND v.shop_id = sv.shop_id
             AND v.shopify_gid = sv.shopify_gid`,
          [params.bulkRunId, params.shopId]
        );

        // Re-enable nested loop for subsequent queries
        await client.query('SET LOCAL enable_nestloop = on');

        params.logger.info(
          { label: 'variants.mark-merged', totalUpdated: res.rowCount ?? 0 },
          'mark-merged complete'
        );
      });

      // Deletes (hard delete) are gated by a full snapshot boundary.
      if (params.allowDeletes && params.isFullSnapshot) {
        // Delete variants missing from the snapshot (for products that exist in snapshot).
        await timed('variants.delete-missing', async () => {
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
        });

        // Delete products missing from the snapshot (cascades to variants).
        await timed('products.delete-missing', async () => {
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
        });
      }

      if (params.analyze) {
        // Keep it best-effort; ANALYZE improves planner stats after heavy upserts.
        await timed('tables.analyze', async () => {
          await client.query('ANALYZE shopify_products');
          await client.query('ANALYZE shopify_variants');
          await client.query('ANALYZE shopify_media');
          await client.query('ANALYZE shopify_product_media');
          await client.query('ANALYZE shopify_variant_media');
        });
      }

      if (params.reindexStaging) {
        // REINDEX staging tables post-merge (best-effort, may be heavy on large runs).
        try {
          await timed('staging.reindex', async () => {
            await client.query('REINDEX TABLE staging_products');
            await client.query('REINDEX TABLE staging_variants');
            await client.query('REINDEX TABLE staging_media');
            await client.query('REINDEX TABLE staging_product_media');
            await client.query('REINDEX TABLE staging_variant_media');
          });
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
