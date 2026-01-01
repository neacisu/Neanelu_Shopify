-- Migration: 0035_create_mv_low_stock_alerts.sql
-- Epic 1, Task 1.2: Products with low inventory
-- Refresh: Every 15 minutes via external scheduler

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_low_stock_alerts AS
SELECT
  v.shop_id,
  v.id as variant_id,
  v.product_id,
  v.sku,
  v.title as variant_title,
  p.title as product_title,
  v.inventory_quantity,
  COALESCE((p.metafields->>'low_stock_threshold')::int, 5) as threshold,
  NOW() as refreshed_at
FROM shopify_variants v
JOIN shopify_products p ON p.id = v.product_id AND p.shop_id = v.shop_id
WHERE v.inventory_quantity <= COALESCE((p.metafields->>'low_stock_threshold')::int, 5)
  AND v.inventory_quantity >= 0
  AND p.status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_mv_low_stock_shop ON mv_low_stock_alerts(shop_id);
CREATE INDEX IF NOT EXISTS idx_mv_low_stock_qty ON mv_low_stock_alerts(inventory_quantity);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_low_stock_pk ON mv_low_stock_alerts(variant_id);

COMMENT ON MATERIALIZED VIEW mv_low_stock_alerts IS 'Low stock alerts. Refresh every 15 minutes.';
