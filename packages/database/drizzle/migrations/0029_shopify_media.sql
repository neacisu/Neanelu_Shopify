-- Migration: 0029_shopify_media.sql
-- Purpose: Add shopify_media, shopify_product_media, shopify_variant_media tables

-- ============================================
-- Table: shopify_media
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_media (
  media_id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  legacy_resource_id BIGINT,
  media_type VARCHAR(30) NOT NULL,
  alt TEXT,
  status VARCHAR(20) NOT NULL,
  mime_type VARCHAR(100),
  file_size BIGINT,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  url TEXT,
  preview_url TEXT,
  sources JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at_shopify TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_media_type CHECK (media_type IN ('IMAGE', 'VIDEO', 'MODEL_3D', 'EXTERNAL_VIDEO')),
  CONSTRAINT chk_media_status CHECK (status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED'))
);

CREATE UNIQUE INDEX idx_media_shop_gid ON shopify_media(shop_id, shopify_gid);
CREATE INDEX idx_media_type ON shopify_media(shop_id, media_type);
CREATE INDEX idx_media_status ON shopify_media(shop_id, status);

ALTER TABLE shopify_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_tenant_isolation ON shopify_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_media FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_shopify_media_updated_at
  BEFORE UPDATE ON shopify_media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: shopify_product_media
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_product_media (
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES shopify_media(media_id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  PRIMARY KEY (product_id, media_id)
);

CREATE INDEX idx_product_media_shop ON shopify_product_media(shop_id);
CREATE INDEX idx_product_media_product ON shopify_product_media(product_id, position);
CREATE INDEX idx_product_media_featured ON shopify_product_media(product_id) WHERE is_featured = true;

ALTER TABLE shopify_product_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_media_tenant_isolation ON shopify_product_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_product_media FORCE ROW LEVEL SECURITY;

-- ============================================
-- Table: shopify_variant_media
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_variant_media (
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES shopify_variants(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES shopify_media(media_id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  PRIMARY KEY (variant_id, media_id)
);

CREATE INDEX idx_variant_media_shop ON shopify_variant_media(shop_id);

ALTER TABLE shopify_variant_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_media_tenant_isolation ON shopify_variant_media
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_variant_media FORCE ROW LEVEL SECURITY;
