-- Migration: 0055_fix_prod_master_constraints_v2.sql
-- Purpose: Ensure prod_master CHECK constraints match canonical, lowercase enum values used by the application.
--
-- Background:
-- Some environments ended up with multiple overlapping constraints (e.g. an uppercase-only chk_prod_master_quality_level,
-- plus a lowercase prod_master_data_quality_level_check). The uppercase-only constraint blocks inserts/updates that use
-- the canonical lowercase values (bronze/silver/golden/review_needed).

-- Normalize existing values (best-effort) before tightening constraints.
UPDATE prod_master
SET data_quality_level = lower(data_quality_level)
WHERE data_quality_level IN ('BRONZE', 'SILVER', 'GOLDEN');

UPDATE prod_master
SET data_quality_level = 'review_needed'
WHERE data_quality_level IN ('REVIEW_NEEDED');

UPDATE prod_master
SET dedupe_status = lower(dedupe_status)
WHERE dedupe_status IN ('UNIQUE', 'MERGED', 'SUSPICIOUS', 'PENDING', 'DUPLICATE');

-- Legacy value observed in older schema versions.
UPDATE prod_master
SET dedupe_status = 'merged'
WHERE dedupe_status = 'duplicate';

-- Drop overlapping / legacy constraints.
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_quality_level;
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS prod_master_data_quality_level_check;

ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_dedupe_status;
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS prod_master_dedupe_status_check;

-- Re-add canonical constraints.
ALTER TABLE prod_master
	ADD CONSTRAINT chk_prod_master_quality_level
	CHECK (data_quality_level IN ('bronze', 'silver', 'golden', 'review_needed'));

ALTER TABLE prod_master
	ADD CONSTRAINT chk_prod_master_dedupe_status
	CHECK (dedupe_status IN ('unique', 'merged', 'suspicious', 'pending'));
