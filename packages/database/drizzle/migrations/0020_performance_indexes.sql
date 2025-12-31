-- Migration: 0020_performance_indexes.sql
-- PR-011: F2.2.15 - Performance Indexes
-- Description: Additional indexes for query optimization
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Index Optimization Guidelines

-- ============================================
-- Indexes from F2.2.15 specification
-- ============================================

-- idx_ledger_shop_variant_date: Already created in 0014_inventory.sql
-- (duplicate prevention)

-- Orders: processed_at index - Already in 0008_shopify_orders.sql

-- Audit: actor index - Already in 0015_audit_logs.sql

-- Embeddings: current combined embeddings
CREATE INDEX IF NOT EXISTS idx_embeddings_product_current 
    ON prod_embeddings(product_id) 
    WHERE embedding_type = 'combined';

-- Jobs: shop + created_at - Already in 0012_job_tracking.sql

-- Products: shop + updated_at for sync
CREATE INDEX IF NOT EXISTS idx_products_shop_updated 
    ON shopify_products(shop_id, updated_at DESC);

-- Jobs: group + status - Already in 0012_job_tracking.sql

-- ============================================
-- Additional performance indexes
-- ============================================

-- Variants: inventory tracking
CREATE INDEX IF NOT EXISTS idx_variants_shop_inventory 
    ON shopify_variants(shop_id, inventory_quantity) 
    WHERE inventory_quantity > 0;

-- Products: status for active listings
CREATE INDEX IF NOT EXISTS idx_products_shop_active 
    ON shopify_products(shop_id, created_at DESC) 
    WHERE status = 'ACTIVE';

-- Customers: total spent for VIP identification
CREATE INDEX IF NOT EXISTS idx_customers_shop_spent 
    ON shopify_customers(shop_id, total_spent DESC) 
    WHERE total_spent > 0;

-- Orders: date range queries
CREATE INDEX IF NOT EXISTS idx_orders_shop_date_range 
    ON shopify_orders(shop_id, created_at_shopify DESC);

-- Bulk runs: recent activity
CREATE INDEX IF NOT EXISTS idx_bulk_runs_shop_recent 
    ON bulk_runs(shop_id, created_at DESC);

-- Collection products: reverse lookup by product
-- Already in 0009_shopify_collections.sql

-- ============================================
-- Comments
-- ============================================
COMMENT ON INDEX idx_embeddings_product_current IS 'Fast lookup for current combined embedding per product';
COMMENT ON INDEX idx_products_shop_updated IS 'Sync optimization: find recently updated products';
COMMENT ON INDEX idx_products_shop_active IS 'Dashboard: active products listing';
