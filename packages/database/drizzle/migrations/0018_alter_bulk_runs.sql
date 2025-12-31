-- Migration: 0018_alter_bulk_runs.sql
-- PR-011: F2.2.12 - Additional Columns and Constraints for bulk_runs
-- Description: Add missing columns and UNIQUE index for lock
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module C: Bulk Operations

-- ============================================
-- Add new columns to bulk_runs
-- Note: api_version, polling_url, result_url already exist
-- ============================================
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS result_size_bytes BIGINT;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS graphql_query_hash VARCHAR(64);
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES staff_users(id);
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cost_estimate INTEGER;

-- ============================================
-- CRITICAL: UNIQUE index for lock - 1 active bulk per shop
-- This prevents race conditions where two bulk operations run simultaneously
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_runs_active_shop 
    ON bulk_runs(shop_id) 
    WHERE status IN ('pending', 'running');

-- ============================================
-- CHECK constraint for status values
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_bulk_status'
    ) THEN
        ALTER TABLE bulk_runs ADD CONSTRAINT chk_bulk_status 
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
    END IF;
END $$;

-- ============================================
-- CHECK constraint for operation_type values
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_bulk_operation_type'
    ) THEN
        ALTER TABLE bulk_runs ADD CONSTRAINT chk_bulk_operation_type 
            CHECK (operation_type IN (
                'PRODUCTS_EXPORT', 'PRODUCTS_IMPORT', 
                'ORDERS_EXPORT', 'CUSTOMERS_EXPORT', 
                'INVENTORY_EXPORT', 'COLLECTIONS_EXPORT'
            ));
    END IF;
END $$;

-- ============================================
-- Index on graphql_query_hash for cache analysis
-- ============================================
CREATE INDEX IF NOT EXISTS idx_bulk_runs_query_hash 
    ON bulk_runs(graphql_query_hash) WHERE graphql_query_hash IS NOT NULL;

-- ============================================
-- Comments
-- ============================================
COMMENT ON COLUMN bulk_runs.result_size_bytes IS 'Size of downloaded JSONL file';
COMMENT ON COLUMN bulk_runs.graphql_query_hash IS 'SHA-256 of GraphQL query for caching analysis';
COMMENT ON COLUMN bulk_runs.cost_estimate IS 'Estimated Shopify API cost for this operation';
COMMENT ON INDEX idx_bulk_runs_active_shop IS 'CRITICAL: Prevents multiple concurrent bulk ops per shop';
