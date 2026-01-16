-- Migration: 0054_fix_prod_master_constraints.sql
-- Purpose: Align prod_master CHECK constraints with the canonical enum values used across the schema (lowercase + review_needed).
--
-- Rationale:
-- - 0005_pim_core_schema.sql defines lowercase values (bronze/silver/golden/review_needed).
-- - 0026_pim_additional_tables.sql (quality events) also uses lowercase.
-- - 0045_add_constraints_fk.sql introduced an uppercase-only constraint which is inconsistent.

-- prod_master: quality level (lowercase + review_needed)
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_quality_level;
ALTER TABLE prod_master ADD CONSTRAINT chk_prod_master_quality_level
	CHECK (data_quality_level IN ('bronze', 'silver', 'golden', 'review_needed'));

-- prod_master: dedupe status (keep v2 semantics)
ALTER TABLE prod_master DROP CONSTRAINT IF EXISTS chk_prod_master_dedupe_status;
ALTER TABLE prod_master ADD CONSTRAINT chk_prod_master_dedupe_status
	CHECK (dedupe_status IN ('unique', 'merged', 'suspicious', 'pending'));
