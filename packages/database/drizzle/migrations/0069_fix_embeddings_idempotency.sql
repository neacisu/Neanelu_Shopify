-- Fix idempotency key for shop_product_embeddings
-- Ensure content_hash participates in uniqueness to prevent duplicates

DROP INDEX IF EXISTS idx_shop_embeddings_product;

CREATE UNIQUE INDEX idx_shop_embeddings_product
  ON shop_product_embeddings (shop_id, product_id, content_hash, embedding_type, model_version);

COMMENT ON INDEX idx_shop_embeddings_product IS
  'Idempotency key: prevents duplicate embeddings for same content';
