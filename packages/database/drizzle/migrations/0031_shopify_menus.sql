-- Migration: 0031_shopify_menus.sql
-- Purpose: Add shopify_menus and shopify_menu_items tables

-- ============================================
-- Table: shopify_menus
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_menus (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  handle VARCHAR(255) NOT NULL,
  items_count INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_menus_shop_gid ON shopify_menus(shop_id, shopify_gid);
CREATE INDEX idx_menus_shop_handle ON shopify_menus(shop_id, handle);

ALTER TABLE shopify_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY menus_tenant_isolation ON shopify_menus
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_menus FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_shopify_menus_updated_at
  BEFORE UPDATE ON shopify_menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: shopify_menu_items
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_menu_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES shopify_menus(id) ON DELETE CASCADE,
  shopify_gid VARCHAR(100) NOT NULL,
  parent_item_id UUID REFERENCES shopify_menu_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  item_type VARCHAR(50),
  resource_id VARCHAR(100),
  position INTEGER DEFAULT 0,
  level INTEGER DEFAULT 0,
  path TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_menu_items_shop_gid ON shopify_menu_items(shop_id, shopify_gid);
CREATE INDEX idx_menu_items_menu ON shopify_menu_items(menu_id, position);
CREATE INDEX idx_menu_items_parent ON shopify_menu_items(parent_item_id);
CREATE INDEX idx_menu_items_type ON shopify_menu_items(shop_id, item_type);
CREATE INDEX idx_menu_items_path ON shopify_menu_items USING GIN (path);

ALTER TABLE shopify_menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_items_tenant_isolation ON shopify_menu_items
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shopify_menu_items FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_shopify_menu_items_updated_at
  BEFORE UPDATE ON shopify_menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
