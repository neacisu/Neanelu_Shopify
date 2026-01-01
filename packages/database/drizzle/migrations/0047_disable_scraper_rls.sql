-- Migration: 0046_disable_scraper_rls.sql
-- Purpose: Disable RLS on scraper tables as they are global

ALTER TABLE scraper_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_queue DISABLE ROW LEVEL SECURITY;
