-- Migration: 0034_create_mv_shop_summary.sql
-- Epic 1, Task 1.1: Dashboard summary metrics per shop
-- Refresh: Hourly via external scheduler

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_shop_summary AS
SELECT 
  s.id as shop_id,
  s.shopify_domain,
  COUNT(DISTINCT sp.id) as total_products,
  COUNT(DISTINCT sv.id) as total_variants,
  COUNT(DISTINCT sc.id) as total_collections,
  COUNT(DISTINCT so.id) as total_orders,
  COALESCE(SUM(so.total_price), 0) as total_revenue,
  COUNT(DISTINCT cust.id) as total_customers,
  MAX(sp.synced_at) as last_product_sync,
  MAX(so.synced_at) as last_order_sync,
  NOW() as refreshed_at
FROM shops s
LEFT JOIN shopify_products sp ON sp.shop_id = s.id AND sp.status = 'ACTIVE'
LEFT JOIN shopify_variants sv ON sv.shop_id = s.id
LEFT JOIN shopify_collections sc ON sc.shop_id = s.id
LEFT JOIN shopify_orders so ON so.shop_id = s.id
LEFT JOIN shopify_customers cust ON cust.shop_id = s.id
GROUP BY s.id, s.shopify_domain;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_shop_summary_pk ON mv_shop_summary(shop_id);

COMMENT ON MATERIALIZED VIEW mv_shop_summary IS 'Dashboard KPIs per shop. Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_summary;';
