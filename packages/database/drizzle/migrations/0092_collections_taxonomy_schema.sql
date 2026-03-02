-- ============================================
-- Migration: 0092_collections_taxonomy_schema.sql
-- Purpose: Collections/taxonomy mapping + AI fields + semantics metadata
-- ============================================

ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS metafields JSONB DEFAULT '{}'::jsonb;

ALTER TABLE prod_master
  ADD COLUMN IF NOT EXISTS taxonomy_ai_confidence DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS taxonomy_ai_status VARCHAR(20) DEFAULT 'manual'
    CHECK (taxonomy_ai_status IN ('pending', 'approved', 'rejected', 'manual')),
  ADD COLUMN IF NOT EXISTS taxonomy_ai_method VARCHAR(20)
    CHECK (taxonomy_ai_method IN ('embedding', 'llm', 'manual'));

CREATE TABLE IF NOT EXISTS pim_taxonomy_collection_map (
    id            UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    taxonomy_id   UUID NOT NULL REFERENCES prod_taxonomy(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES shopify_collections(id) ON DELETE CASCADE,
    is_primary    BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (shop_id, taxonomy_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_collection_map_shop_tax
  ON pim_taxonomy_collection_map (shop_id, taxonomy_id);

CREATE TABLE IF NOT EXISTS pim_taxonomy_metafield_schema (
    id                UUID PRIMARY KEY DEFAULT uuidv7(),
    taxonomy_id       UUID NOT NULL REFERENCES prod_taxonomy(id) ON DELETE CASCADE,
    attr_code         VARCHAR(100) NOT NULL,
    shopify_namespace VARCHAR(100) NOT NULL,
    shopify_key       VARCHAR(100) NOT NULL,
    shopify_type      VARCHAR(50) NOT NULL,
    is_required       BOOLEAN DEFAULT false,
    display_name      VARCHAR(200),
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (taxonomy_id, attr_code)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_metafield_schema_taxonomy
  ON pim_taxonomy_metafield_schema (taxonomy_id);

ALTER TABLE prod_semantics
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES pim_description_templates(id),
  ADD COLUMN IF NOT EXISTS generated_by VARCHAR(50),
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;
