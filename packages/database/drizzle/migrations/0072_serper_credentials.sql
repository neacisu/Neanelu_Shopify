-- Migration: 0072_serper_credentials.sql
-- Purpose: Add Serper API credentials to shop_ai_credentials table

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS serper_api_key_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS serper_api_key_iv BYTEA,
  ADD COLUMN IF NOT EXISTS serper_api_key_tag BYTEA,
  ADD COLUMN IF NOT EXISTS serper_key_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS serper_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serper_daily_budget INTEGER DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS serper_rate_limit_per_second INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS serper_cache_ttl_seconds INTEGER DEFAULT 86400,
  ADD COLUMN IF NOT EXISTS serper_budget_alert_threshold NUMERIC(3, 2) DEFAULT 0.80;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_serper_daily_budget'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_serper_daily_budget
      CHECK (serper_daily_budget >= 0 AND serper_daily_budget <= 100000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_serper_rate_limit'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_serper_rate_limit
      CHECK (serper_rate_limit_per_second >= 1 AND serper_rate_limit_per_second <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_serper_cache_ttl'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_serper_cache_ttl
      CHECK (serper_cache_ttl_seconds >= 0 AND serper_cache_ttl_seconds <= 604800);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_serper_budget_alert'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_serper_budget_alert
      CHECK (serper_budget_alert_threshold >= 0.50 AND serper_budget_alert_threshold <= 0.99);
  END IF;
END $$;

COMMENT ON COLUMN shop_ai_credentials.serper_api_key_ciphertext IS 'AES-256-GCM encrypted Serper API key';
COMMENT ON COLUMN shop_ai_credentials.serper_enabled IS 'Enable Serper external search for this shop';
COMMENT ON COLUMN shop_ai_credentials.serper_daily_budget IS 'Maximum daily Serper API requests';
COMMENT ON COLUMN shop_ai_credentials.serper_cache_ttl_seconds IS 'Cache TTL for Serper results (default 24h)';
