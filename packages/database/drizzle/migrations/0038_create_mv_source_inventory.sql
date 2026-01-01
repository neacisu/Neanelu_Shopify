-- Migration: 0038_create_mv_source_inventory.sql
-- Epic 1, Task 1.6-1.7: Source performance and inventory current
-- Refresh: Daily (source), 5 min (inventory)

-- MV 1: Source API Performance (based on prod_sources config and prod_raw_harvest)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pim_source_performance AS
SELECT
  ps.source_type,
  ps.name as source_name,
  COUNT(prh.id) as total_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'completed') as successful_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'pending') as pending_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'failed') as failed_harvests,
  ROUND(
    COUNT(prh.id) FILTER (WHERE prh.processing_status = 'completed')::numeric / 
    NULLIF(COUNT(prh.id)::numeric, 0) * 100, 2
  ) as success_rate,
  ps.trust_score,
  ps.is_active,
  MAX(prh.fetched_at) as last_harvest_at,
  NOW() as refreshed_at
FROM prod_sources ps
LEFT JOIN prod_raw_harvest prh ON prh.source_id = ps.id
GROUP BY ps.id, ps.source_type, ps.name, ps.trust_score, ps.is_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pim_source_perf_pk ON mv_pim_source_performance(source_type);

COMMENT ON MATERIALIZED VIEW mv_pim_source_performance IS 'Source API performance stats. Refresh daily.';

-- MV 2: Current Inventory Snapshot
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_inventory_current AS
SELECT
  v.shop_id,
  il.id as location_id,
  il.name as location_name,
  COUNT(DISTINCT v.product_id) as products_count,
  COUNT(DISTINCT v.id) as variants_count,
  COALESCE(SUM(v.inventory_quantity), 0) as total_units,
  COALESCE(SUM(v.inventory_quantity * v.price), 0) as inventory_value,
  COUNT(*) FILTER (WHERE v.inventory_quantity <= 0) as out_of_stock_count,
  COUNT(*) FILTER (WHERE v.inventory_quantity > 0 AND v.inventory_quantity <= 5) as low_stock_count,
  NOW() as refreshed_at
FROM shopify_variants v
JOIN inventory_locations il ON il.shop_id = v.shop_id
JOIN shopify_products p ON p.id = v.product_id AND p.status = 'ACTIVE'
GROUP BY v.shop_id, il.id, il.name;

CREATE INDEX IF NOT EXISTS idx_mv_inventory_shop ON mv_inventory_current(shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_inventory_pk ON mv_inventory_current(shop_id, location_id);

COMMENT ON MATERIALIZED VIEW mv_inventory_current IS 'Current inventory snapshot. Refresh every 5 minutes.';
