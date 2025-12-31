-- Migration: 0023_shopify_metaobjects_webhooks.sql
-- Purpose: Add shopify_metaobjects and shopify_webhooks tables

-- ============================================
-- Table: shopify_metaobjects
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_metaobjects (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  type VARCHAR(100) NOT NULL,
  handle VARCHAR(255) NOT NULL,
  display_name TEXT,
  fields JSONB NOT NULL,
  capabilities JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_metaobjects_shop_gid ON shopify_metaobjects(shop_id, shopify_gid);
CREATE INDEX idx_metaobjects_shop_type ON shopify_metaobjects(shop_id, type);
CREATE INDEX idx_metaobjects_shop_handle ON shopify_metaobjects(shop_id, type, handle);
CREATE INDEX idx_metaobjects_fields ON shopify_metaobjects USING GIN (fields jsonb_path_ops);

-- RLS
ALTER TABLE shopify_metaobjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY metaobjects_tenant_isolation ON shopify_metaobjects
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_metaobjects FORCE ROW LEVEL SECURITY;

-- Trigger
CREATE TRIGGER trg_shopify_metaobjects_updated_at
  BEFORE UPDATE ON shopify_metaobjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: shopify_webhooks
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_webhooks (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  topic VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  format VARCHAR(10) DEFAULT 'json',
  api_version VARCHAR(20),
  include_fields TEXT[],
  metafield_namespaces TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_webhooks_shop_gid ON shopify_webhooks(shop_id, shopify_gid);
CREATE INDEX idx_webhooks_shop_topic ON shopify_webhooks(shop_id, topic);

-- RLS
ALTER TABLE shopify_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant_isolation ON shopify_webhooks
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_webhooks FORCE ROW LEVEL SECURITY;
