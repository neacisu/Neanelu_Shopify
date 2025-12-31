-- Migration: 0014_inventory.sql
-- PR-011: Inventory Tables
-- Description: Inventory locations and ledger for high-velocity tracking
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module I: Inventory Ledger
-- PARTITIONING: inventory_ledger uses monthly partitions

-- ============================================
-- Table: inventory_locations
-- ============================================
CREATE TABLE inventory_locations (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    shopify_gid VARCHAR(100) NOT NULL,
    legacy_resource_id BIGINT,
    name VARCHAR(255) NOT NULL,
    address JSONB,
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,
    fulfills_online_orders BOOLEAN DEFAULT true,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for inventory_locations
-- ============================================
CREATE UNIQUE INDEX idx_locations_shop_gid ON inventory_locations(shop_id, shopify_gid);
CREATE INDEX idx_locations_shop_active ON inventory_locations(shop_id, is_active);

-- ============================================
-- RLS Policy for inventory_locations
-- ============================================
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_inventory_locations ON inventory_locations
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Table: inventory_ledger (PARTITIONED)
-- Append-only ledger for inventory changes
-- ============================================
CREATE TABLE inventory_ledger (
    id UUID DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES shopify_variants(id) ON DELETE CASCADE,
    sku VARCHAR(255),  -- Denormalized for queries
    location_id VARCHAR(100),  -- Shopify location GID
    delta INTEGER NOT NULL,  -- +/- quantity change
    reason VARCHAR(50) NOT NULL,  -- SALE/RESTOCK/ADJUSTMENT/RETURN/SYNC/TRANSFER/DAMAGE/CORRECTION
    reference_type VARCHAR(50),  -- order/transfer/bulk_run
    reference_id VARCHAR(255),
    previous_quantity INTEGER,
    new_quantity INTEGER,
    cost_per_unit DECIMAL(12,2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- ============================================
-- Monthly Partitions for inventory_ledger 2025
-- ============================================
CREATE TABLE inventory_ledger_2025_01 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE inventory_ledger_2025_02 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE inventory_ledger_2025_03 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE inventory_ledger_2025_04 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE inventory_ledger_2025_05 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE inventory_ledger_2025_06 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE inventory_ledger_2025_07 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE inventory_ledger_2025_08 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE inventory_ledger_2025_09 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE inventory_ledger_2025_10 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE inventory_ledger_2025_11 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE inventory_ledger_2025_12 PARTITION OF inventory_ledger
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- ============================================
-- Indexes for inventory_ledger
-- ============================================
CREATE INDEX idx_ledger_variant ON inventory_ledger(variant_id, recorded_at DESC);
CREATE INDEX idx_ledger_shop_sku ON inventory_ledger(shop_id, sku, recorded_at DESC) 
    WHERE sku IS NOT NULL;
CREATE INDEX idx_ledger_location ON inventory_ledger(location_id, recorded_at DESC) 
    WHERE location_id IS NOT NULL;
CREATE INDEX idx_ledger_reference ON inventory_ledger(reference_type, reference_id) 
    WHERE reference_type IS NOT NULL;
CREATE INDEX idx_ledger_reason ON inventory_ledger(shop_id, reason, recorded_at DESC);
CREATE INDEX idx_ledger_shop_variant_date ON inventory_ledger(shop_id, variant_id, recorded_at DESC);

-- ============================================
-- RLS Policy for inventory_ledger
-- ============================================
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_inventory_ledger ON inventory_ledger
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE inventory_locations IS 'Shopify fulfillment locations';
COMMENT ON TABLE inventory_ledger IS 'Append-only inventory change ledger - partitioned monthly';
COMMENT ON COLUMN inventory_ledger.delta IS 'Positive for additions, negative for subtractions';
COMMENT ON COLUMN inventory_ledger.reason IS 'SALE, RESTOCK, ADJUSTMENT, RETURN, SYNC, TRANSFER, DAMAGE, CORRECTION';
