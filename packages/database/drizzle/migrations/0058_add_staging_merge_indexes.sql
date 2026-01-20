-- Add composite indexes to speed staging merge updates

CREATE INDEX IF NOT EXISTS idx_staging_products_merge_run_shop_gid
  ON staging_products (bulk_run_id, shop_id, validation_status, merge_status, shopify_gid);

CREATE INDEX IF NOT EXISTS idx_staging_variants_merge_run_shop_gid
  ON staging_variants (bulk_run_id, shop_id, validation_status, merge_status, shopify_gid);
