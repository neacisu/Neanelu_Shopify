-- Migration: 0067_staging_media.sql
-- Purpose: Add staging media tables + extra product/variant columns for bulk ingest

-- ============================================
-- Extend staging_products for media + pricing
-- ============================================
ALTER TABLE staging_products
  ADD COLUMN IF NOT EXISTS featured_image_url TEXT,
  ADD COLUMN IF NOT EXISTS price_range JSONB,
  ADD COLUMN IF NOT EXISTS compare_at_price_range JSONB,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS template_suffix VARCHAR(100),
  ADD COLUMN IF NOT EXISTS has_only_default_variant BOOLEAN,
  ADD COLUMN IF NOT EXISTS total_inventory INTEGER,
  ADD COLUMN IF NOT EXISTS collections JSONB DEFAULT '[]';

-- ============================================
-- Extend staging_variants for media
-- ============================================
ALTER TABLE staging_variants
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ============================================
-- Table: staging_media (UNLOGGED for performance)
-- ============================================
CREATE UNLOGGED TABLE IF NOT EXISTS staging_media (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  legacy_resource_id BIGINT,
  media_type VARCHAR(30) NOT NULL,
  alt TEXT,
  status VARCHAR(20),
  mime_type VARCHAR(100),
  file_size BIGINT,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  url TEXT,
  preview_url TEXT,
  sources JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  raw_data JSONB,
  imported_at TIMESTAMPTZ DEFAULT now(),
  validation_status VARCHAR(20) DEFAULT 'pending',
  validation_errors JSONB DEFAULT '[]',
  merge_status VARCHAR(20) DEFAULT 'pending',
  merged_at TIMESTAMPTZ,
  target_media_id UUID REFERENCES shopify_media(media_id),

  CONSTRAINT chk_staging_media_type CHECK (media_type IN ('IMAGE', 'VIDEO', 'MODEL_3D', 'EXTERNAL_VIDEO')),
  CONSTRAINT chk_staging_media_status CHECK (status IS NULL OR status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED')),
  CONSTRAINT chk_staging_media_validation CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  CONSTRAINT chk_staging_media_merge CHECK (merge_status IN ('pending', 'merged', 'skipped', 'failed'))
);

CREATE INDEX idx_staging_media_run ON staging_media(bulk_run_id);
CREATE INDEX idx_staging_media_validation ON staging_media(bulk_run_id, validation_status);
CREATE INDEX idx_staging_media_merge ON staging_media(bulk_run_id, merge_status);
CREATE INDEX idx_staging_media_gid ON staging_media(shop_id, shopify_gid);

ALTER TABLE staging_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_media_tenant_isolation ON staging_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE staging_media FORCE ROW LEVEL SECURITY;

-- ============================================
-- Table: staging_product_media (UNLOGGED for performance)
-- ============================================
CREATE UNLOGGED TABLE IF NOT EXISTS staging_product_media (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_shopify_gid VARCHAR(100) NOT NULL,
  media_shopify_gid VARCHAR(100) NOT NULL,
  position INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  imported_at TIMESTAMPTZ DEFAULT now(),
  validation_status VARCHAR(20) DEFAULT 'pending',
  validation_errors JSONB DEFAULT '[]',
  merge_status VARCHAR(20) DEFAULT 'pending',
  merged_at TIMESTAMPTZ,

  CONSTRAINT chk_staging_product_media_validation CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  CONSTRAINT chk_staging_product_media_merge CHECK (merge_status IN ('pending', 'merged', 'skipped', 'failed'))
);

CREATE INDEX idx_staging_product_media_run ON staging_product_media(bulk_run_id);
CREATE INDEX idx_staging_product_media_validation ON staging_product_media(bulk_run_id, validation_status);
CREATE INDEX idx_staging_product_media_merge ON staging_product_media(bulk_run_id, merge_status);
CREATE INDEX idx_staging_product_media_gid ON staging_product_media(shop_id, product_shopify_gid, media_shopify_gid);

ALTER TABLE staging_product_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_product_media_tenant_isolation ON staging_product_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE staging_product_media FORCE ROW LEVEL SECURITY;

-- ============================================
-- Table: staging_variant_media (UNLOGGED for performance)
-- ============================================
CREATE UNLOGGED TABLE IF NOT EXISTS staging_variant_media (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  variant_shopify_gid VARCHAR(100) NOT NULL,
  media_shopify_gid VARCHAR(100) NOT NULL,
  position INTEGER DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT now(),
  validation_status VARCHAR(20) DEFAULT 'pending',
  validation_errors JSONB DEFAULT '[]',
  merge_status VARCHAR(20) DEFAULT 'pending',
  merged_at TIMESTAMPTZ,

  CONSTRAINT chk_staging_variant_media_validation CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  CONSTRAINT chk_staging_variant_media_merge CHECK (merge_status IN ('pending', 'merged', 'skipped', 'failed'))
);

CREATE INDEX idx_staging_variant_media_run ON staging_variant_media(bulk_run_id);
CREATE INDEX idx_staging_variant_media_validation ON staging_variant_media(bulk_run_id, validation_status);
CREATE INDEX idx_staging_variant_media_merge ON staging_variant_media(bulk_run_id, merge_status);
CREATE INDEX idx_staging_variant_media_gid ON staging_variant_media(shop_id, variant_shopify_gid, media_shopify_gid);

ALTER TABLE staging_variant_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_variant_media_tenant_isolation ON staging_variant_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE staging_variant_media FORCE ROW LEVEL SECURITY;
