-- Migration: 0043_add_performance_indexes.sql (CORRECTED)
-- Epic 5: Performance optimization indexes

-- ============================================
-- SECTION 1: Dashboard Query Indexes
-- ============================================

-- Products: shop + status + updated (for dashboard counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_shop_status_updated 
  ON shopify_products(shop_id, status, updated_at DESC);

-- Variants: low inventory lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variants_shop_inventory_low 
  ON shopify_variants(shop_id, inventory_quantity) 
  WHERE inventory_quantity <= 10;

-- Orders: financial status for revenue queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_financial 
  ON shopify_orders(shop_id, financial_status, created_at DESC);

-- Orders: date range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_created 
  ON shopify_orders(shop_id, created_at DESC);

-- ============================================
-- SECTION 2: Vector Search Indexes
-- ============================================

-- Embeddings: type filter for search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_embeddings_type_product 
  ON prod_embeddings(embedding_type, product_id);

-- Shop embeddings: shop filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_embeddings_shop_type 
  ON shop_product_embeddings(shop_id, embedding_type);

-- ============================================
-- SECTION 3: Bulk Operations Indexes
-- ============================================

-- Bulk runs: shop + status + created (for active runs lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bulk_runs_shop_status_created 
  ON bulk_runs(shop_id, status, created_at DESC);

-- ============================================
-- SECTION 4: PIM Indexes
-- ============================================

-- PIM master: quality level distribution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_master_quality_level 
  ON prod_master(data_quality_level);

-- PIM master: needs review queue
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_master_needs_review 
  ON prod_master(needs_review, updated_at DESC) 
  WHERE needs_review = true;

-- PIM master: brand lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_master_brand 
  ON prod_master(brand) 
  WHERE brand IS NOT NULL;

-- ============================================
-- SECTION 5: GIN Indexes for JSONB
-- ============================================

-- Products metafields (if not exists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_metafields_gin 
  ON shopify_products USING GIN(metafields jsonb_path_ops);

-- Variants metafields
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variants_metafields_gin 
  ON shopify_variants USING GIN(metafields jsonb_path_ops);

-- Orders line_items (for product lookup in orders)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_line_items_gin 
  ON shopify_orders USING GIN(line_items jsonb_path_ops);

-- PIM specs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_specs_gin 
  ON prod_specs_normalized USING GIN(specs jsonb_path_ops);

-- PIM provenance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prod_specs_provenance_gin 
  ON prod_specs_normalized USING GIN(provenance jsonb_path_ops);

-- ============================================
-- SECTION 6: Partitioned Table Indexes (NON-CONCURRENT)
-- Note: Partitioned tables cannot use CONCURRENTLY
-- ============================================

-- Audit logs: shop + action + time 
CREATE INDEX IF NOT EXISTS idx_audit_logs_shop_action_time 
  ON audit_logs(shop_id, action, timestamp DESC);

-- API cost: shop + date
CREATE INDEX IF NOT EXISTS idx_api_cost_shop_date 
  ON api_cost_tracking(shop_id, requested_at DESC);
