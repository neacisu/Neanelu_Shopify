-- Schedule pg_cron maintenance for embeddings tables
-- Requires pg_cron extension and appropriate privileges

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Weekly VACUUM ANALYZE for embeddings tables (Sunday 03:00 UTC)
    PERFORM cron.schedule(
      'vacuum-embeddings-weekly',
      '0 3 * * 0',
      $cron$
        VACUUM ANALYZE shop_product_embeddings;
        VACUUM ANALYZE prod_embeddings;
        VACUUM ANALYZE ai_batches;
        VACUUM ANALYZE ai_batch_items;
      $cron$
    );

    -- Monthly REINDEX CONCURRENTLY for HNSW index health (first Sunday 04:00 UTC)
    PERFORM cron.schedule(
      'reindex-embeddings-monthly',
      '0 4 1-7 * 0',
      $cron$
        REINDEX INDEX CONCURRENTLY idx_shop_embeddings_vector;
      $cron$
    );
  END IF;
END $$;
