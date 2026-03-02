-- ============================================
-- Migration: 0089_prod_taxonomy_embeddings.sql
-- Purpose: Add embeddings to taxonomy for AI category classification
-- ============================================

ALTER TABLE prod_taxonomy
  ADD COLUMN IF NOT EXISTS embedding vector(2000);

CREATE INDEX IF NOT EXISTS idx_prod_taxonomy_embedding_ivfflat
  ON prod_taxonomy USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
