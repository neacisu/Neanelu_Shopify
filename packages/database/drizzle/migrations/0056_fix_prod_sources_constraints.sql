-- Migration: 0056_fix_prod_sources_constraints.sql
-- Purpose: Remove legacy prod_sources source_type constraint that blocks canonical lowercase values used by the app.
--
-- Background:
-- The schema already has a canonical constraint (chk_prod_sources_type) permitting:
--   brand / curated / ai_extracted / bulk_import / webhook / scraping / manual
-- Some environments also have a legacy uppercase-only prod_sources_source_type_check
-- permitting:
--   SUPPLIER / MANUFACTURER / SCRAPER / API / MANUAL
--
-- The application uses lowercase values like 'bulk_import', which the legacy constraint rejects.

-- Best-effort normalization of any legacy uppercase values.
UPDATE prod_sources
SET source_type = CASE source_type
	WHEN 'SCRAPER' THEN 'scraping'
	WHEN 'MANUAL' THEN 'manual'
	WHEN 'API' THEN 'webhook'
	WHEN 'SUPPLIER' THEN 'brand'
	WHEN 'MANUFACTURER' THEN 'brand'
	ELSE lower(source_type)
END
WHERE source_type IN ('SUPPLIER', 'MANUFACTURER', 'SCRAPER', 'API', 'MANUAL');

-- Drop the legacy constraint; keep chk_prod_sources_type as authoritative.
ALTER TABLE prod_sources
	DROP CONSTRAINT IF EXISTS prod_sources_source_type_check;
