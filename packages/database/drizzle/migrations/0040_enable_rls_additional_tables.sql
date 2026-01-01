-- Migration: 0040_enable_rls_additional_tables.sql (CORRECTED)
-- Epic 2: Enable RLS for tables that need tenant isolation

-- ============================================
-- SECTION 1: Rate Limiting & API Tables
-- ============================================

-- rate_limit_buckets (shop_id = PK)
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_buckets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_rate_limit ON rate_limit_buckets;
CREATE POLICY tenant_isolation_rate_limit ON rate_limit_buckets
  FOR ALL TO PUBLIC
  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- api_usage_log
ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_api_usage ON api_usage_log;
CREATE POLICY tenant_isolation_api_usage ON api_usage_log
  FOR ALL TO PUBLIC
  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- SECTION 2: AI Batch Tables
-- ============================================

-- ai_batches (shop_id nullable - allow global batches)
ALTER TABLE ai_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_batches ON ai_batches;
CREATE POLICY tenant_isolation_ai_batches ON ai_batches
  FOR ALL TO PUBLIC
  USING (
    shop_id IS NULL OR 
    shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ai_batch_items
ALTER TABLE ai_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_batch_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_batch_items ON ai_batch_items;
CREATE POLICY tenant_isolation_ai_batch_items ON ai_batch_items
  FOR ALL TO PUBLIC
  USING (
    shop_id IS NULL OR 
    shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ============================================
-- SECTION 3: PIM Channel Mappings (has shop_id directly!)
-- ============================================

-- prod_channel_mappings has shop_id column directly
ALTER TABLE prod_channel_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod_channel_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_channel_mappings ON prod_channel_mappings;
CREATE POLICY tenant_isolation_channel_mappings ON prod_channel_mappings
  FOR ALL TO PUBLIC
  USING (
    shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ============================================
-- SECTION 4: Scraper Tables (NO shop_id - Global by design)
-- These tables are intentionally GLOBAL:
-- - scraper_configs: global configuration
-- - scraper_queue: URLs to crawl (not tenant-specific)
-- - scraper_runs: crawl execution history (linked to config, not shop)
-- ============================================

-- Documentation only - no RLS needed for scraper tables
-- They do not have shop_id column by design

-- ============================================
-- DOCUMENTATION: Global Tables (No RLS Intentionally)
-- ============================================
-- The following tables are GLOBAL and do NOT require RLS:
-- 
-- SCRAPER LAYER (global by design):
-- - scraper_configs: global scraping configuration
-- - scraper_queue: URLs to crawl (no shop context)
-- - scraper_runs: crawl execution logs
--
-- PIM GOVERNANCE (global product catalog):
-- - prod_taxonomy: Shopify standard categories
-- - prod_attr_definitions: global attribute registry
-- - prod_attr_synonyms: global synonyms
-- - prod_raw_harvest: raw data before shop assignment
-- - prod_extraction_sessions: AI extraction
-- - prod_master: Golden Record (global PIM core)
-- - prod_specs_normalized: specs per product
-- - prod_sources: source configuration
-- - prod_embeddings: product vectors for dedupe
-- - prod_semantics: semantic analysis
-- - prod_similarity_matches: duplicate detection
-- - prod_dedupe_clusters: cluster definitions
-- - prod_dedupe_cluster_members: cluster membership
-- - prod_proposals: change proposals
-- - prod_quality_events: quality history
-- - prod_translations: i18n
-- 
-- SYSTEM:
-- - migration_history: system
-- - feature_flags: system config
-- - system_config: system settings
-- - oauth_states: pre-auth temp data
-- - oauth_nonces: pre-auth temp data
-- - key_rotations: admin-only
