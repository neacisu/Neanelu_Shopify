-- Migration: 0066_ai_settings_extended.sql
-- Purpose: Extend shop_ai_credentials with embedding batch size + similarity threshold

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS embedding_batch_size INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS similarity_threshold NUMERIC(3, 2) DEFAULT 0.80;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_embedding_batch_size'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_embedding_batch_size
      CHECK (embedding_batch_size >= 10 AND embedding_batch_size <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_similarity_threshold'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_similarity_threshold
      CHECK (similarity_threshold >= 0.70 AND similarity_threshold <= 0.95);
  END IF;
END $$;
