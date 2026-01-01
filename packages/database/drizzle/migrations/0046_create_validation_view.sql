-- Migration: 0046_create_validation_view.sql (CORRECTED)
-- Epic 8: Schema validation and documentation

-- ============================================
-- View: Schema Validation Status
-- ============================================

CREATE OR REPLACE VIEW v_schema_validation AS

-- RLS Status
SELECT 
  'RLS_STATUS' as check_category,
  COUNT(*) FILTER (WHERE c.relrowsecurity) as enabled_count,
  COUNT(*) FILTER (WHERE NOT c.relrowsecurity) as disabled_count,
  string_agg(
    CASE WHEN NOT c.relrowsecurity THEN c.relname ELSE NULL END, 
    ', ' ORDER BY c.relname
  ) FILTER (WHERE NOT c.relrowsecurity AND c.relname NOT LIKE 'pg_%' AND c.relname NOT LIKE 'prod_%' AND c.relname NOT LIKE 'migration%' AND c.relname NOT LIKE 'oauth%' AND c.relname NOT LIKE 'feature%' AND c.relname NOT LIKE 'system%' AND c.relname NOT LIKE 'key%' AND c.relname NOT LIKE 'scraper%') as items_needing_attention
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'

UNION ALL

-- Materialized Views Count
SELECT 
  'MATERIALIZED_VIEWS',
  (SELECT COUNT(*) FROM pg_matviews WHERE schemaname = 'public'),
  7 - (SELECT COUNT(*) FROM pg_matviews WHERE schemaname = 'public'),
  (SELECT string_agg(matviewname, ', ' ORDER BY matviewname) FROM pg_matviews WHERE schemaname = 'public')

UNION ALL

-- Partitioned Tables Count
SELECT 
  'PARTITIONED_TABLES',
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'p'),
  4 - (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'p'),
  (SELECT string_agg(c.relname, ', ' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'p');

COMMENT ON VIEW v_schema_validation IS 'Validation view for schema completeness checks';

-- ============================================
-- View: Table Statistics Summary
-- ============================================

DROP VIEW IF EXISTS v_table_stats;
CREATE VIEW v_table_stats AS
SELECT 
  c.relname as table_name,
  CASE 
    WHEN c.relrowsecurity THEN 'ON'
    ELSE 'OFF'
  END as rls_status,
  CASE 
    WHEN c.relforcerowsecurity THEN 'FORCED'
    ELSE 'NOT_FORCED'
  END as rls_forced,
  c.reltuples::bigint as estimated_rows,
  pg_size_pretty(pg_relation_size(c.oid)) as table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) as indexes_size,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = c.oid) as index_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT LIKE 'pg_%'
  AND c.relname NOT LIKE '%_20%'
ORDER BY pg_total_relation_size(c.oid) DESC;

COMMENT ON VIEW v_table_stats IS 'Table statistics including RLS status, size, row counts.';

-- ============================================
-- View: Index Statistics (FIXED syntax)
-- ============================================

DROP VIEW IF EXISTS v_index_stats;
CREATE VIEW v_index_stats AS
SELECT 
  s.schemaname,
  s.relname as tablename,
  s.indexrelname as indexname,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
  s.idx_scan as scans,
  s.idx_tup_read as tuples_read,
  s.idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes s
ORDER BY s.idx_scan DESC;

COMMENT ON VIEW v_index_stats IS 'Index usage statistics for optimization analysis.';
