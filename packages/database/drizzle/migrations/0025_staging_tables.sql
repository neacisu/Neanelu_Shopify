-- Migration: 0025_staging_tables.sql
-- Purpose: Add staging_products and staging_variants for bulk import pipeline

-- ============================================
-- Table: staging_products (UNLOGGED for performance)
-- ============================================
CREATE UNLOGGED TABLE IF NOT EXISTS staging_products (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100),
  legacy_resource_id BIGINT,
  title TEXT,
  handle VARCHAR(255),
  description TEXT,
  description_html TEXT,
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  status VARCHAR(20),
  tags TEXT[] DEFAULT '{}',
  options JSONB DEFAULT '[]',
  seo JSONB,
  metafields JSONB DEFAULT '{}',
  raw_data JSONB,
  imported_at TIMESTAMPTZ DEFAULT now(),
  validation_status VARCHAR(20) DEFAULT 'pending',
  validation_errors JSONB DEFAULT '[]',
  merge_status VARCHAR(20) DEFAULT 'pending',
  merged_at TIMESTAMPTZ,
  target_product_id UUID REFERENCES shopify_products(id),
  
  CONSTRAINT chk_staging_product_validation CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  CONSTRAINT chk_staging_product_merge CHECK (merge_status IN ('pending', 'merged', 'skipped', 'failed'))
);

CREATE INDEX idx_staging_products_run ON staging_products(bulk_run_id);
CREATE INDEX idx_staging_products_validation ON staging_products(bulk_run_id, validation_status);
CREATE INDEX idx_staging_products_merge ON staging_products(bulk_run_id, merge_status);
CREATE INDEX idx_staging_products_gid ON staging_products(shop_id, shopify_gid);

-- RLS
ALTER TABLE staging_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_products_tenant_isolation ON staging_products
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE staging_products FORCE ROW LEVEL SECURITY;

-- ============================================
-- Table: staging_variants (UNLOGGED for performance)
-- ============================================
CREATE UNLOGGED TABLE IF NOT EXISTS staging_variants (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  staging_product_id UUID REFERENCES staging_products(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100),
  legacy_resource_id BIGINT,
  title VARCHAR(255),
  sku VARCHAR(255),
  barcode VARCHAR(100),
  price DECIMAL(12,2),
  compare_at_price DECIMAL(12,2),
  cost DECIMAL(12,2),
  inventory_quantity INTEGER,
  inventory_item_id VARCHAR(100),
  weight DECIMAL(10,4),
  weight_unit VARCHAR(20),
  selected_options JSONB DEFAULT '[]',
  metafields JSONB DEFAULT '{}',
  raw_data JSONB,
  imported_at TIMESTAMPTZ DEFAULT now(),
  validation_status VARCHAR(20) DEFAULT 'pending',
  validation_errors JSONB DEFAULT '[]',
  merge_status VARCHAR(20) DEFAULT 'pending',
  merged_at TIMESTAMPTZ,
  target_variant_id UUID REFERENCES shopify_variants(id),
  
  CONSTRAINT chk_staging_variant_validation CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  CONSTRAINT chk_staging_variant_merge CHECK (merge_status IN ('pending', 'merged', 'skipped', 'failed'))
);

CREATE INDEX idx_staging_variants_run ON staging_variants(bulk_run_id);
CREATE INDEX idx_staging_variants_product ON staging_variants(staging_product_id);
CREATE INDEX idx_staging_variants_validation ON staging_variants(bulk_run_id, validation_status);
CREATE INDEX idx_staging_variants_gid ON staging_variants(shop_id, shopify_gid);

-- RLS
ALTER TABLE staging_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_variants_tenant_isolation ON staging_variants
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE staging_variants FORCE ROW LEVEL SECURITY;
