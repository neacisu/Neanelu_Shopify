-- Migration: 0106_dual_model_embeddings.sql
-- Purpose: store secondary embeddings for selfhosted + OpenAI retrieval

ALTER TABLE prod_taxonomy
  ADD COLUMN IF NOT EXISTS embedding_secondary vector(2000),
  ADD COLUMN IF NOT EXISTS model_version_secondary VARCHAR(255);

ALTER TABLE shopify_menu_items
  ADD COLUMN IF NOT EXISTS embedding_secondary vector(2000),
  ADD COLUMN IF NOT EXISTS embedding_model_secondary VARCHAR(255);

ALTER TABLE shop_product_embeddings
  ADD COLUMN IF NOT EXISTS embedding_secondary vector(2000),
  ADD COLUMN IF NOT EXISTS model_version_secondary VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_prod_taxonomy_embedding_secondary
  ON prod_taxonomy USING ivfflat (embedding_secondary vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding_secondary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_menu_items_embedding_secondary
  ON shopify_menu_items USING ivfflat (embedding_secondary vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding_secondary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_product_embeddings_embedding_secondary
  ON shop_product_embeddings USING ivfflat (embedding_secondary vector_cosine_ops)
  WITH (lists = 200)
  WHERE embedding_secondary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prod_taxonomy_model_version_secondary
  ON prod_taxonomy (model_version_secondary)
  WHERE model_version_secondary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_menu_items_embedding_model_secondary
  ON shopify_menu_items (shop_id, embedding_model_secondary)
  WHERE embedding_model_secondary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_product_embeddings_model_version_secondary
  ON shop_product_embeddings (shop_id, model_version_secondary)
  WHERE model_version_secondary IS NOT NULL;
