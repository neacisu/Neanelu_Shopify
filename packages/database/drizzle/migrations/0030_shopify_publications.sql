-- Migration: 0030_shopify_publications.sql
-- Purpose: Add shopify_publications and shopify_resource_publications tables

-- ============================================
-- Table: shopify_publications
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_publications (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  catalog_type VARCHAR(50),
  supports_future_publishing BOOLEAN DEFAULT false,
  auto_publish BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_publications_shop_gid ON shopify_publications(shop_id, shopify_gid);
CREATE INDEX idx_publications_shop_active ON shopify_publications(shop_id, is_active);

ALTER TABLE shopify_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY publications_tenant_isolation ON shopify_publications
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_publications FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_shopify_publications_updated_at
  BEFORE UPDATE ON shopify_publications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: shopify_resource_publications
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_resource_publications (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES shopify_publications(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  publish_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_resource_pub_publication ON shopify_resource_publications(publication_id);
CREATE UNIQUE INDEX idx_resource_pub_resource ON shopify_resource_publications(shop_id, publication_id, resource_type, resource_id);
CREATE INDEX idx_resource_pub_published ON shopify_resource_publications(shop_id, resource_type, is_published);

ALTER TABLE shopify_resource_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_publications_tenant_isolation ON shopify_resource_publications
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_resource_publications FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_shopify_resource_publications_updated_at
  BEFORE UPDATE ON shopify_resource_publications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
