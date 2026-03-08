-- Migration: 0105_menu_items_embedding.sql
-- Purpose: Store menu item embeddings for AI category placement retrieval

ALTER TABLE shopify_menu_items
  ADD COLUMN IF NOT EXISTS embedding vector(2000),
  ADD COLUMN IF NOT EXISTS embedding_text TEXT,
  ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_menu_items_embedding
  ON shopify_menu_items USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_embedding_model
  ON shopify_menu_items(shop_id, embedding_model)
  WHERE embedding_model IS NOT NULL;

COMMENT ON COLUMN shopify_menu_items.embedding IS
  'Pre-generated vector(2000) embedding used for AI menu placement candidate retrieval';

COMMENT ON COLUMN shopify_menu_items.embedding_text IS
  'Canonical text used to generate the current menu item embedding';

COMMENT ON COLUMN shopify_menu_items.embedding_model IS
  'Embedding model name that generated the current menu item vector';
