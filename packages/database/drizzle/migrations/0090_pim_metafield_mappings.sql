-- ============================================
-- Migration: 0090_pim_metafield_mappings.sql
-- Purpose: Product metafield mapping configuration + push logs
-- ============================================

CREATE TABLE IF NOT EXISTS pim_metafield_mappings (
    id                UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id           UUID REFERENCES shops(id) ON DELETE CASCADE,
    attr_code         VARCHAR(100) NOT NULL,
    shopify_namespace VARCHAR(100) NOT NULL,
    shopify_key       VARCHAR(100) NOT NULL,
    shopify_type      VARCHAR(50) NOT NULL,
    is_active         BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (shop_id, attr_code)
);

CREATE TABLE IF NOT EXISTS pim_metafield_push_log (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
    shopify_product_gid TEXT,
    pushed_at           TIMESTAMPTZ DEFAULT now(),
    metafields_count    INTEGER DEFAULT 0,
    status              TEXT CHECK (status IN ('success', 'partial', 'failed')),
    error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_pim_metafield_push_log_shop_product
  ON pim_metafield_push_log (shop_id, product_id, pushed_at DESC);

INSERT INTO pim_metafield_mappings (shop_id, attr_code, shopify_namespace, shopify_key, shopify_type)
VALUES
  (NULL, 'features',         'custom', 'features',         'list.single_line_text_field'),
  (NULL, 'instructions',     'custom', 'instructions',     'multi_line_text_field'),
  (NULL, 'installation',     'custom', 'installation',     'multi_line_text_field'),
  (NULL, 'maintenance',      'custom', 'maintenance',      'multi_line_text_field'),
  (NULL, 'compatibility',    'custom', 'compatibility',    'multi_line_text_field'),
  (NULL, 'package_contents', 'custom', 'package_contents', 'multi_line_text_field'),
  (NULL, 'safety',           'custom', 'safety',           'multi_line_text_field'),
  (NULL, 'warranty',         'custom', 'warranty',         'single_line_text_field')
ON CONFLICT (shop_id, attr_code) DO NOTHING;
