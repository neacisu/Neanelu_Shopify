-- ============================================
-- Migration: 0093_seed_taxonomy_metafield_schemas.sql
-- Purpose: Seed default taxonomy metafield schema entries
-- ============================================

INSERT INTO pim_taxonomy_metafield_schema
  (taxonomy_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_required, display_name)
SELECT pt.id, 'voltage', 'custom', 'voltage', 'single_line_text_field', false, 'Tensiune'
FROM prod_taxonomy pt
WHERE pt.shopify_taxonomy_id LIKE 'gid://shopify/TaxonomyCategory/el-%'
ON CONFLICT DO NOTHING;

INSERT INTO pim_taxonomy_metafield_schema
  (taxonomy_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_required, display_name)
SELECT pt.id, 'material', 'custom', 'material', 'single_line_text_field', false, 'Material'
FROM prod_taxonomy pt
WHERE pt.shopify_taxonomy_id LIKE 'gid://shopify/TaxonomyCategory/ap-%'
ON CONFLICT DO NOTHING;

INSERT INTO pim_taxonomy_metafield_schema
  (taxonomy_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_required, display_name)
SELECT pt.id, 'dimensions', 'custom', 'dimensions', 'single_line_text_field', false, 'Dimensiuni'
FROM prod_taxonomy pt
WHERE pt.shopify_taxonomy_id LIKE 'gid://shopify/TaxonomyCategory/hg-%'
ON CONFLICT DO NOTHING;
