-- Migration: 0008_shopify_orders.sql
-- PR-011: F2.2.8-F2.2.17 Database Schema Completions
-- Description: Create shopify_orders table
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module B: Shopify Mirror

-- ============================================
-- Table: shopify_orders
-- ============================================
CREATE TABLE shopify_orders (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    shopify_gid VARCHAR(100) NOT NULL,
    legacy_resource_id BIGINT NOT NULL,
    name VARCHAR(50) NOT NULL,  -- #1001, etc.
    order_number INTEGER NOT NULL,
    email TEXT,
    phone VARCHAR(50),
    financial_status VARCHAR(30),  -- PENDING/PAID/REFUNDED/PARTIALLY_REFUNDED/VOIDED
    fulfillment_status VARCHAR(30),  -- UNFULFILLED/FULFILLED/PARTIAL/RESTOCKED
    total_price DECIMAL(12,2) NOT NULL,
    subtotal_price DECIMAL(12,2),
    total_tax DECIMAL(12,2),
    total_discounts DECIMAL(12,2),
    total_shipping DECIMAL(12,2),
    currency_code VARCHAR(3) NOT NULL,
    presentment_currency VARCHAR(3),
    line_items JSONB NOT NULL,  -- [{variant_id, quantity, price, title}]
    shipping_lines JSONB DEFAULT '[]',
    discount_codes JSONB DEFAULT '[]',
    shipping_address JSONB,
    billing_address JSONB,
    customer_id UUID REFERENCES shopify_customers(id) ON DELETE SET NULL,
    customer_locale VARCHAR(10),
    tags TEXT[] DEFAULT '{}',
    note TEXT,
    note_attributes JSONB DEFAULT '[]',
    gateway VARCHAR(100),
    payment_terms JSONB,
    risk_level VARCHAR(20),  -- LOW/MEDIUM/HIGH
    source_name VARCHAR(100),  -- web/pos/api
    source_identifier VARCHAR(255),
    cancelled_at TIMESTAMPTZ,
    cancel_reason VARCHAR(50),
    closed_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    created_at_shopify TIMESTAMPTZ,
    updated_at_shopify TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE UNIQUE INDEX idx_orders_shop_gid ON shopify_orders(shop_id, shopify_gid);
CREATE INDEX idx_orders_shop_number ON shopify_orders(shop_id, order_number);
CREATE INDEX idx_orders_shop_email ON shopify_orders(shop_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_orders_customer ON shopify_orders(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_financial ON shopify_orders(shop_id, financial_status);
CREATE INDEX idx_orders_fulfillment ON shopify_orders(shop_id, fulfillment_status);
CREATE INDEX idx_orders_created ON shopify_orders(shop_id, created_at_shopify DESC);
CREATE INDEX idx_orders_processed ON shopify_orders(shop_id, processed_at DESC) WHERE processed_at IS NOT NULL;
CREATE INDEX idx_orders_line_items ON shopify_orders USING GIN(line_items jsonb_path_ops);
CREATE INDEX idx_orders_tags ON shopify_orders USING GIN(tags);

-- ============================================
-- RLS Policy
-- ============================================
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shopify_orders ON shopify_orders
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE shopify_orders IS 'Shopify orders mirror - synced via Bulk API or webhooks';
COMMENT ON COLUMN shopify_orders.financial_status IS 'PENDING, PAID, REFUNDED, PARTIALLY_REFUNDED, VOIDED';
COMMENT ON COLUMN shopify_orders.fulfillment_status IS 'UNFULFILLED, FULFILLED, PARTIAL, RESTOCKED';
