-- Migration: 0009_shopify_collections.sql
-- PR-011: F2.2.8-F2.2.17 Database Schema Completions
-- Description: Create shopify_collections and shopify_collection_products tables
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module B: Shopify Mirror
-- Implements F2.2.14: RLS Join Tables (shop_id denormalized)

-- ============================================
-- Table: shopify_collections
-- ============================================
CREATE TABLE shopify_collections (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    shopify_gid VARCHAR(100) NOT NULL,
    legacy_resource_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    handle VARCHAR(255) NOT NULL,
    description TEXT,
    description_html TEXT,
    collection_type VARCHAR(20) NOT NULL,  -- MANUAL/SMART
    sort_order VARCHAR(50),  -- BEST_SELLING, ALPHA_ASC, etc.
    rules JSONB,  -- Smart collection rules
    disjunctive BOOLEAN DEFAULT false,  -- OR vs AND for rules
    seo JSONB,
    image_url TEXT,
    products_count INTEGER DEFAULT 0,
    template_suffix VARCHAR(100),
    published_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for shopify_collections
-- ============================================
CREATE UNIQUE INDEX idx_collections_shop_gid ON shopify_collections(shop_id, shopify_gid);
CREATE INDEX idx_collections_shop_handle ON shopify_collections(shop_id, handle);
CREATE INDEX idx_collections_type ON shopify_collections(shop_id, collection_type);

-- ============================================
-- RLS Policy for shopify_collections
-- ============================================
ALTER TABLE shopify_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_collections FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_shopify_collections ON shopify_collections
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Table: shopify_collection_products (Join Table)
-- F2.2.14: shop_id denormalized for RLS
-- ============================================
CREATE TABLE shopify_collection_products (
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES shopify_collections(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (collection_id, product_id)
);

-- ============================================
-- Indexes for shopify_collection_products
-- ============================================
CREATE INDEX idx_collection_products_shop ON shopify_collection_products(shop_id);
CREATE INDEX idx_collection_products_product ON shopify_collection_products(product_id);

-- ============================================
-- RLS Policy for shopify_collection_products
-- F2.2.14: Direct RLS without join
-- ============================================
ALTER TABLE shopify_collection_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_collection_products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_collection_products ON shopify_collection_products
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE shopify_collections IS 'Shopify collections mirror (MANUAL and SMART)';
COMMENT ON TABLE shopify_collection_products IS 'Many-to-many: collections-products with denormalized shop_id for RLS';
COMMENT ON COLUMN shopify_collection_products.shop_id IS 'Denormalized for direct RLS without join';
