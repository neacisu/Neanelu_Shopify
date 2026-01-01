-- Migration: 0036_create_mv_top_sellers.sql
-- Epic 1, Task 1.3: Top selling products per shop (last 30 days)
-- Refresh: Daily via external scheduler

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_sellers AS
WITH order_items AS (
  SELECT
    o.shop_id,
    (item->>'variant_id')::uuid as variant_id,
    (item->>'quantity')::int as quantity,
    (item->>'price')::decimal as price
  FROM shopify_orders o,
       jsonb_array_elements(o.line_items) as item
  WHERE o.created_at >= NOW() - INTERVAL '30 days'
    AND o.financial_status IN ('paid', 'partially_refunded')
)
SELECT
  oi.shop_id,
  v.product_id,
  p.title as product_title,
  SUM(oi.quantity) as units_sold,
  SUM(oi.quantity * oi.price) as revenue,
  COUNT(DISTINCT oi.variant_id) as variants_sold,
  RANK() OVER (PARTITION BY oi.shop_id ORDER BY SUM(oi.quantity * oi.price) DESC) as revenue_rank,
  NOW() as refreshed_at
FROM order_items oi
JOIN shopify_variants v ON v.id = oi.variant_id
JOIN shopify_products p ON p.id = v.product_id
GROUP BY oi.shop_id, v.product_id, p.title;

CREATE INDEX IF NOT EXISTS idx_mv_top_sellers_shop ON mv_top_sellers(shop_id);
CREATE INDEX IF NOT EXISTS idx_mv_top_sellers_rank ON mv_top_sellers(shop_id, revenue_rank);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_top_sellers_pk ON mv_top_sellers(shop_id, product_id);

COMMENT ON MATERIALIZED VIEW mv_top_sellers IS 'Top selling products (last 30 days). Refresh daily.';
