-- category_id pe staging_products (shopify_products.category_id exista deja)
ALTER TABLE staging_products
  ADD COLUMN IF NOT EXISTS category_id VARCHAR(100);

-- Feature flag pentru auto-chain meta (permite dezactivare rapida in productie)
INSERT INTO feature_flags (flag_key, default_value, is_active, description)
VALUES ('bulk.meta_auto_chain.enabled', true, true, 'Auto-trigger meta bulk op after core completes')
ON CONFLICT (flag_key) DO NOTHING;
