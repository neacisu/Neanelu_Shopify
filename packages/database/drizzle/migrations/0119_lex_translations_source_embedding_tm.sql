-- Migration: 0119_lex_translations_source_embedding_tm.sql
-- Purpose: Translation Memory — store embedding of source-side text (joined at runtime with lex_terms) for pgvector similarity

ALTER TABLE lex_translations
  ADD COLUMN IF NOT EXISTS source_embedding vector(2000);

COMMENT ON COLUMN lex_translations.source_embedding IS
  'Embedding of canonical/source text for approved translations; use with lex_terms for TM lookup.';

CREATE INDEX IF NOT EXISTS idx_lex_translations_source_embedding_hnsw
  ON lex_translations
  USING hnsw (source_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128)
  WHERE source_embedding IS NOT NULL;
