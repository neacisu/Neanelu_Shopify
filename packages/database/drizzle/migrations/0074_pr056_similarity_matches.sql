-- Migration: 0074_pr056_similarity_matches.sql
-- Purpose: Align prod_similarity_matches with documented schema and constraints

-- 1. Add missing columns (keep existing verified_* naming for compatibility)
ALTER TABLE prod_similarity_matches
  ADD COLUMN IF NOT EXISTS source_product_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_brand VARCHAR(255),
  ADD COLUMN IF NOT EXISTS match_details JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extraction_session_id UUID,
  ADD COLUMN IF NOT EXISTS specs_extracted JSONB,
  ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_notes TEXT;

-- 2. Fix precision for similarity_score
ALTER TABLE prod_similarity_matches
  ALTER COLUMN similarity_score TYPE DECIMAL(5,4);

-- 3. Expand confidence constraint to include 'uncertain'
ALTER TABLE prod_similarity_matches
  DROP CONSTRAINT IF EXISTS chk_similarity_confidence;
ALTER TABLE prod_similarity_matches
  ADD CONSTRAINT chk_similarity_confidence
  CHECK (match_confidence IN ('pending', 'confirmed', 'rejected', 'uncertain'));

-- 4. Add foreign key to prod_extraction_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_similarity_extraction'
      AND table_name = 'prod_similarity_matches'
  ) THEN
    ALTER TABLE prod_similarity_matches
      ADD CONSTRAINT fk_similarity_extraction
      FOREIGN KEY (extraction_session_id) REFERENCES prod_extraction_sessions(id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_similarity_extraction: %', SQLERRM;
END $$;

-- 5. Add missing indexes
CREATE INDEX IF NOT EXISTS idx_similarity_method
  ON prod_similarity_matches(match_method, match_confidence);
CREATE INDEX IF NOT EXISTS idx_similarity_confirmed
  ON prod_similarity_matches(product_id, is_primary_source)
  WHERE match_confidence = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_similarity_url
  ON prod_similarity_matches(source_url);

-- 6. Ensure valid score range
ALTER TABLE prod_similarity_matches
  ADD CONSTRAINT chk_similarity_score_range
  CHECK (similarity_score >= 0 AND similarity_score <= 1);
