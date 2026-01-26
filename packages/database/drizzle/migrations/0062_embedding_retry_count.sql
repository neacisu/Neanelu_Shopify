ALTER TABLE shop_product_embeddings
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_shop_embeddings_retry
  ON shop_product_embeddings (shop_id, status, retry_count)
  WHERE status = 'failed';

COMMENT ON COLUMN shop_product_embeddings.retry_count
  IS 'Number of retry attempts for failed embeddings';
