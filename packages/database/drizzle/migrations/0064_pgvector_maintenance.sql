-- pgvector maintenance guidance (run via cron/pg_cron outside migrations)
-- VACUUM ANALYZE shop_product_embeddings;
-- VACUUM ANALYZE prod_embeddings;

-- Partial index for common search path (combined embeddings)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_embeddings_combined
  ON shop_product_embeddings(shop_id)
  WHERE embedding_type = 'combined';
