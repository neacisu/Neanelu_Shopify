-- Migration: 0050_scraper_no_rls_hardening.sql
-- Canonical: scraper tables are global infra, no shop_id requirement, no RLS.

DO $$
DECLARE
  pol record;
BEGIN
  -- Drop any existing policies on scraper tables
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('scraper_configs', 'scraper_runs', 'scraper_queue')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;

  -- Ensure RLS is disabled (and not forced)
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='scraper_configs') THEN
    EXECUTE 'ALTER TABLE scraper_configs DISABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE scraper_configs NO FORCE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='scraper_runs') THEN
    EXECUTE 'ALTER TABLE scraper_runs DISABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE scraper_runs NO FORCE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='scraper_queue') THEN
    EXECUTE 'ALTER TABLE scraper_queue DISABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE scraper_queue NO FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
