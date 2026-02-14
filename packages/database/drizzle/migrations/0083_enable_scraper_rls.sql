-- Migration: 0083_enable_scraper_rls.sql
-- Purpose: Enforce tenant isolation on scraper_* tables (shop_id now exists).

ALTER TABLE scraper_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scraper_configs_tenant_isolation ON scraper_configs;
CREATE POLICY scraper_configs_tenant_isolation ON scraper_configs
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

DROP POLICY IF EXISTS scraper_runs_tenant_isolation ON scraper_runs;
CREATE POLICY scraper_runs_tenant_isolation ON scraper_runs
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

DROP POLICY IF EXISTS scraper_queue_tenant_isolation ON scraper_queue;
CREATE POLICY scraper_queue_tenant_isolation ON scraper_queue
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE scraper_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE scraper_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE scraper_queue FORCE ROW LEVEL SECURITY;

