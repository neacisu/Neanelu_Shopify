-- Migration: 0007_shopify_customers.sql
-- PR-011: F2.2.8-F2.2.17 Database Schema Completions
-- Description: Create shopify_customers table (prerequisite for orders)
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module B: Shopify Mirror

-- ============================================
-- Table: shopify_customers
-- ============================================
CREATE TABLE shopify_customers (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    shopify_gid VARCHAR(100) NOT NULL,
    legacy_resource_id BIGINT NOT NULL,
    email TEXT,  -- Shopify allows null email for some customers
    phone VARCHAR(50),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    display_name VARCHAR(255),
    state VARCHAR(20) DEFAULT 'ENABLED',  -- ENABLED/DISABLED/INVITED
    verified_email BOOLEAN DEFAULT false,
    accepts_marketing BOOLEAN DEFAULT false,
    accepts_marketing_updated_at TIMESTAMPTZ,
    marketing_opt_in_level VARCHAR(30),
    orders_count INTEGER DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    average_order_amount DECIMAL(12,2),
    currency_code VARCHAR(3),
    tags TEXT[] DEFAULT '{}',
    tax_exempt BOOLEAN DEFAULT false,
    tax_exemptions TEXT[] DEFAULT '{}',
    locale VARCHAR(10),
    note TEXT,
    default_address JSONB,
    addresses JSONB DEFAULT '[]',
    metafields JSONB DEFAULT '{}',
    created_at_shopify TIMESTAMPTZ,
    updated_at_shopify TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE UNIQUE INDEX idx_customers_shop_gid ON shopify_customers(shop_id, shopify_gid);
CREATE INDEX idx_customers_shop_email ON shopify_customers(shop_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_customers_shop_phone ON shopify_customers(shop_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_customers_tags ON shopify_customers USING GIN(tags);
CREATE INDEX idx_customers_metafields ON shopify_customers USING GIN(metafields jsonb_path_ops);

-- ============================================
-- RLS Policy
-- ============================================
ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shopify_customers ON shopify_customers
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE shopify_customers IS 'Shopify customers mirror - synced via Bulk API or webhooks';
COMMENT ON COLUMN shopify_customers.state IS 'Customer state: ENABLED, DISABLED, INVITED';
COMMENT ON COLUMN shopify_customers.marketing_opt_in_level IS 'Marketing opt-in: SINGLE_OPT_IN, CONFIRMED_OPT_IN, UNKNOWN';
