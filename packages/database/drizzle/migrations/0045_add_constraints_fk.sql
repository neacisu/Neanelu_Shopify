-- Migration: 0045_add_constraints_fk.sql (CORRECTED)
-- Epic 7: Additional CHECK constraints and foreign keys

-- ============================================
-- SECTION 1: CHECK Constraints (with CORRECT column names)
-- ============================================

-- prod_master: quality level
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_quality_level;
ALTER TABLE prod_master ADD CONSTRAINT chk_prod_master_quality_level 
  CHECK (data_quality_level IN ('BRONZE', 'SILVER', 'GOLDEN'));

-- prod_master: dedupe status
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_dedupe_status;
ALTER TABLE prod_master ADD CONSTRAINT chk_prod_master_dedupe_status 
  CHECK (dedupe_status IN ('unique', 'merged', 'suspicious', 'pending'));

-- scraper_runs: status
ALTER TABLE scraper_runs DROP CONSTRAINT IF EXISTS chk_scraper_runs_status;
ALTER TABLE scraper_runs ADD CONSTRAINT chk_scraper_runs_status 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

-- prod_proposals: proposal_status (correct column name)
ALTER TABLE prod_proposals DROP CONSTRAINT IF EXISTS chk_prod_proposals_status;
ALTER TABLE prod_proposals ADD CONSTRAINT chk_prod_proposals_status 
  CHECK (proposal_status IN ('pending', 'approved', 'rejected', 'applied'));

-- ai_batches: status
ALTER TABLE ai_batches DROP CONSTRAINT IF EXISTS chk_ai_batches_status;
ALTER TABLE ai_batches ADD CONSTRAINT chk_ai_batches_status 
  CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'cancelled'));

-- embedding_batches: batch_type
ALTER TABLE embedding_batches DROP CONSTRAINT IF EXISTS chk_embedding_batches_type;
ALTER TABLE embedding_batches ADD CONSTRAINT chk_embedding_batches_type 
  CHECK (batch_type IN ('product_title', 'product_description', 'specs', 'combined', 'attribute'));

-- embedding_batches: status
ALTER TABLE embedding_batches DROP CONSTRAINT IF EXISTS chk_embedding_batches_status;
ALTER TABLE embedding_batches ADD CONSTRAINT chk_embedding_batches_status 
  CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'cancelled'));

-- prod_sources: source_type
ALTER TABLE prod_sources DROP CONSTRAINT IF EXISTS chk_prod_sources_type;
ALTER TABLE prod_sources ADD CONSTRAINT chk_prod_sources_type 
  CHECK (source_type IN ('brand', 'curated', 'ai_extracted', 'bulk_import', 'webhook', 'scraping', 'manual'));

-- prod_embeddings: embedding_type
ALTER TABLE prod_embeddings DROP CONSTRAINT IF EXISTS chk_prod_embeddings_type;
ALTER TABLE prod_embeddings ADD CONSTRAINT chk_prod_embeddings_type 
  CHECK (embedding_type IN ('title', 'description', 'full', 'title_brand', 'combined'));

-- prod_channel_mappings: sync_status
ALTER TABLE prod_channel_mappings DROP CONSTRAINT IF EXISTS chk_channel_mappings_status;
ALTER TABLE prod_channel_mappings ADD CONSTRAINT chk_channel_mappings_status 
  CHECK (sync_status IN ('pending', 'synced', 'error', 'stale'));

-- scraper_queue: status
ALTER TABLE scraper_queue DROP CONSTRAINT IF EXISTS chk_scraper_queue_status;
ALTER TABLE scraper_queue ADD CONSTRAINT chk_scraper_queue_status 
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

-- ============================================
-- SECTION 2: Foreign Keys (with CORRECT column names)
-- ============================================

-- prod_channel_mappings -> prod_master via product_id
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_channel_mappings_product' 
    AND table_name = 'prod_channel_mappings'
  ) THEN
    ALTER TABLE prod_channel_mappings 
      ADD CONSTRAINT fk_channel_mappings_product 
      FOREIGN KEY (product_id) REFERENCES prod_master(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_channel_mappings_product: %', SQLERRM;
END $$;

-- prod_embeddings -> prod_master
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_embeddings_product' 
    AND table_name = 'prod_embeddings'
  ) THEN
    ALTER TABLE prod_embeddings 
      ADD CONSTRAINT fk_embeddings_product 
      FOREIGN KEY (product_id) REFERENCES prod_master(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_embeddings_product: %', SQLERRM;
END $$;

-- prod_specs_normalized -> prod_master
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_specs_product' 
    AND table_name = 'prod_specs_normalized'
  ) THEN
    ALTER TABLE prod_specs_normalized 
      ADD CONSTRAINT fk_specs_product 
      FOREIGN KEY (product_id) REFERENCES prod_master(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_specs_product: %', SQLERRM;
END $$;

-- prod_similarity_matches -> prod_master via product_id
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_similarity_product' 
    AND table_name = 'prod_similarity_matches'
  ) THEN
    ALTER TABLE prod_similarity_matches 
      ADD CONSTRAINT fk_similarity_product 
      FOREIGN KEY (product_id) REFERENCES prod_master(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_similarity_product: %', SQLERRM;
END $$;

-- prod_proposals -> prod_master via product_id
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_proposals_product' 
    AND table_name = 'prod_proposals'
  ) THEN
    ALTER TABLE prod_proposals 
      ADD CONSTRAINT fk_proposals_product 
      FOREIGN KEY (product_id) REFERENCES prod_master(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK fk_proposals_product: %', SQLERRM;
END $$;
