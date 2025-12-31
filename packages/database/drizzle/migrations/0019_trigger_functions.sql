-- Migration: 0019_trigger_functions.sql
-- PR-011: F2.2.13 - Trigger Functions
-- Description: Standard trigger functions for auto-update and auditing
-- 
-- CONFORM: Database_Schema_Complete.md v2.6

-- ============================================
-- Function: update_updated_at()
-- Auto-update updated_at column on any UPDATE
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at() IS 'Auto-update updated_at timestamp on row modification';

-- ============================================
-- Function: audit_critical_action()
-- Insert audit log entry for critical operations
-- ============================================
CREATE OR REPLACE FUNCTION audit_critical_action()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (
        shop_id, 
        action, 
        actor_type, 
        resource_type, 
        resource_id, 
        details, 
        trace_id
    ) VALUES (
        COALESCE(NEW.shop_id, OLD.shop_id), 
        TG_ARGV[0],  -- Action name passed as trigger argument
        'system', 
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        jsonb_build_object(
            'operation', TG_OP, 
            'old', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
            'new', CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END
        ),
        current_setting('app.trace_id', true)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_critical_action() IS 'Auto-insert audit log for critical table changes';

-- ============================================
-- Function: create_partition_if_not_exists()
-- Dynamic partition creation for partitioned tables
-- ============================================
CREATE OR REPLACE FUNCTION create_partition_if_not_exists(
    parent_table TEXT, 
    partition_date DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    start_date := date_trunc('month', partition_date)::DATE;
    end_date := (start_date + INTERVAL '1 month')::DATE;
    partition_name := parent_table || '_' || to_char(start_date, 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I 
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, parent_table, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_partition_if_not_exists(TEXT, DATE) IS 'Create monthly partition for a partitioned table';

-- ============================================
-- Apply update_updated_at trigger to key tables
-- ============================================

-- shops
DROP TRIGGER IF EXISTS trg_shops_updated_at ON shops;
CREATE TRIGGER trg_shops_updated_at
    BEFORE UPDATE ON shops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- shopify_products
DROP TRIGGER IF EXISTS trg_products_updated_at ON shopify_products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON shopify_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- shopify_variants
DROP TRIGGER IF EXISTS trg_variants_updated_at ON shopify_variants;
CREATE TRIGGER trg_variants_updated_at
    BEFORE UPDATE ON shopify_variants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- shopify_customers
DROP TRIGGER IF EXISTS trg_customers_updated_at ON shopify_customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON shopify_customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- shopify_orders
DROP TRIGGER IF EXISTS trg_orders_updated_at ON shopify_orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON shopify_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- shopify_collections
DROP TRIGGER IF EXISTS trg_collections_updated_at ON shopify_collections;
CREATE TRIGGER trg_collections_updated_at
    BEFORE UPDATE ON shopify_collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- bulk_runs
DROP TRIGGER IF EXISTS trg_bulk_runs_updated_at ON bulk_runs;
CREATE TRIGGER trg_bulk_runs_updated_at
    BEFORE UPDATE ON bulk_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- scheduled_tasks
DROP TRIGGER IF EXISTS trg_scheduled_tasks_updated_at ON scheduled_tasks;
CREATE TRIGGER trg_scheduled_tasks_updated_at
    BEFORE UPDATE ON scheduled_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- embedding_batches
DROP TRIGGER IF EXISTS trg_embedding_batches_updated_at ON embedding_batches;
CREATE TRIGGER trg_embedding_batches_updated_at
    BEFORE UPDATE ON embedding_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- rate_limit_buckets
DROP TRIGGER IF EXISTS trg_rate_limit_buckets_updated_at ON rate_limit_buckets;
CREATE TRIGGER trg_rate_limit_buckets_updated_at
    BEFORE UPDATE ON rate_limit_buckets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
