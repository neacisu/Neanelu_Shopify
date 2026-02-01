-- pgvector maintenance script (schedule via cron/pg_cron)
-- Recommended: weekly during low-traffic window.
-- Note: VACUUM cannot run inside a transaction block.

VACUUM ANALYZE shop_product_embeddings;
VACUUM ANALYZE prod_embeddings;
VACUUM ANALYZE prod_attr_definitions;
