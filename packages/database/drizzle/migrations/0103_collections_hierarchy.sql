ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS parent_collection_id UUID REFERENCES shopify_collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS menu_level INTEGER,
  ADD COLUMN IF NOT EXISTS menu_path TEXT;

CREATE INDEX IF NOT EXISTS idx_collections_parent
  ON shopify_collections(parent_collection_id);

CREATE INDEX IF NOT EXISTS idx_collections_menu_level
  ON shopify_collections(shop_id, menu_level);

COMMENT ON COLUMN shopify_collections.parent_collection_id
  IS 'Parent collection resolved from the Shopify menu hierarchy when the collection is present in a synced menu tree';

COMMENT ON COLUMN shopify_collections.menu_level
  IS 'Zero-based tree depth resolved from the synced Shopify menu hierarchy (0=root collection in menu, 1=child, 2=grandchild)';

COMMENT ON COLUMN shopify_collections.menu_path
  IS 'Human-readable breadcrumb path resolved from the synced Shopify menu hierarchy';
