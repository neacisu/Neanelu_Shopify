-- Migration: 0082_scraper_shop_isolation_and_settings.sql
-- Purpose:
--   1) Persist scraper settings per shop in shop_ai_credentials
--   2) Add explicit shop_id isolation to scraper_* tables

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS scraper_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS scraper_rate_limit_per_domain INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scraper_timeout_ms INTEGER DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS scraper_max_concurrent_pages INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS scraper_user_agent TEXT DEFAULT 'NeaneluPIM/1.0',
  ADD COLUMN IF NOT EXISTS scraper_robots_cache_ttl INTEGER DEFAULT 86400,
  ADD COLUMN IF NOT EXISTS scraper_connection_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS scraper_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scraper_last_error TEXT,
  ADD COLUMN IF NOT EXISTS scraper_last_success_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shop_ai_credentials_scraper_connection_status_check'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT shop_ai_credentials_scraper_connection_status_check
      CHECK (scraper_connection_status IN ('unknown', 'pending', 'ok', 'error', 'disabled', 'not_installed'));
  END IF;
END
$$;

ALTER TABLE scraper_configs
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE CASCADE;

ALTER TABLE scraper_runs
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE CASCADE;

ALTER TABLE scraper_queue
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scraper_configs_shop ON scraper_configs(shop_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_shop ON scraper_runs(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_queue_shop ON scraper_queue(shop_id, status, next_attempt_at);
