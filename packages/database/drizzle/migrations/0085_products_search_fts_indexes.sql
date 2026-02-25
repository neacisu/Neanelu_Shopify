-- Migration: 0085_products_search_fts_indexes.sql
-- Purpose: speed up /api/products search with proper FTS + SKU fallback indexing

-- GIN index for product full-text search on title + description + handle
CREATE INDEX IF NOT EXISTS idx_products_search_fts_gin
  ON shopify_products
  USING GIN (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(handle, '')
    )
  );

-- Trigram GIN index for SKU ILIKE fallback in variant existence subquery
CREATE INDEX IF NOT EXISTS idx_variants_sku_trgm_gin
  ON shopify_variants
  USING GIN (sku gin_trgm_ops)
  WHERE sku IS NOT NULL;
