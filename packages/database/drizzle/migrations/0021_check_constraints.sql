-- Migration: 0021_check_constraints.sql
-- PR-011: F2.2.16 - CHECK Constraints for Data Integrity
-- Description: Add CHECK constraints to ensure data validity
-- 
-- CONFORM: Database_Schema_Complete.md v2.6

-- ============================================
-- shopify_products: status constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_status'
    ) THEN
        ALTER TABLE shopify_products ADD CONSTRAINT chk_product_status 
            CHECK (status IN ('ACTIVE', 'DRAFT', 'ARCHIVED'));
    END IF;
END $$;

-- ============================================
-- inventory_ledger: reason constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ledger_reason'
    ) THEN
        ALTER TABLE inventory_ledger ADD CONSTRAINT chk_ledger_reason 
            CHECK (reason IN ('SALE', 'RESTOCK', 'ADJUSTMENT', 'RETURN', 'SYNC', 'TRANSFER', 'DAMAGE', 'CORRECTION'));
    END IF;
END $$;

-- ============================================
-- shopify_collections: collection_type constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_collection_type'
    ) THEN
        ALTER TABLE shopify_collections ADD CONSTRAINT chk_collection_type 
            CHECK (collection_type IN ('MANUAL', 'SMART'));
    END IF;
END $$;

-- ============================================
-- shopify_orders: financial_status constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_financial_status'
    ) THEN
        ALTER TABLE shopify_orders ADD CONSTRAINT chk_order_financial_status 
            CHECK (financial_status IS NULL OR financial_status IN (
                'PENDING', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED', 'AUTHORIZED'
            ));
    END IF;
END $$;

-- ============================================
-- shopify_orders: fulfillment_status constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_fulfillment_status'
    ) THEN
        ALTER TABLE shopify_orders ADD CONSTRAINT chk_order_fulfillment_status 
            CHECK (fulfillment_status IS NULL OR fulfillment_status IN (
                'UNFULFILLED', 'FULFILLED', 'PARTIAL', 'RESTOCKED'
            ));
    END IF;
END $$;

-- ============================================
-- shopify_customers: state constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_state'
    ) THEN
        ALTER TABLE shopify_customers ADD CONSTRAINT chk_customer_state 
            CHECK (state IS NULL OR state IN ('ENABLED', 'DISABLED', 'INVITED', 'DECLINED'));
    END IF;
END $$;

-- ============================================
-- job_runs: status constraint
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_status'
    ) THEN
        ALTER TABLE job_runs ADD CONSTRAINT chk_job_status 
            CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'delayed'));
    END IF;
END $$;

-- ============================================
-- Comments
-- ============================================
COMMENT ON CONSTRAINT chk_product_status ON shopify_products IS 'Shopify product status: ACTIVE, DRAFT, ARCHIVED';
COMMENT ON CONSTRAINT chk_ledger_reason ON inventory_ledger IS 'Inventory change reasons for audit';
COMMENT ON CONSTRAINT chk_collection_type ON shopify_collections IS 'Shopify collection type: MANUAL or SMART';
