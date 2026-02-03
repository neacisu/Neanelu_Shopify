-- Migration: 0075_xai_credentials.sql
-- Purpose: Add xAI Grok credentials and configuration to shop_ai_credentials

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS xai_api_key_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS xai_api_key_iv BYTEA,
  ADD COLUMN IF NOT EXISTS xai_api_key_tag BYTEA,
  ADD COLUMN IF NOT EXISTS xai_key_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS xai_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS xai_base_url TEXT,
  ADD COLUMN IF NOT EXISTS xai_model TEXT,
  ADD COLUMN IF NOT EXISTS xai_temperature NUMERIC(3, 2) DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS xai_max_tokens_per_request INTEGER DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS xai_rate_limit_per_minute INTEGER DEFAULT 60,
  ADD COLUMN IF NOT EXISTS xai_daily_budget INTEGER DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS xai_budget_alert_threshold NUMERIC(3, 2) DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS xai_connection_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS xai_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xai_last_error TEXT,
  ADD COLUMN IF NOT EXISTS xai_last_success_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_xai_daily_budget'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_xai_daily_budget
      CHECK (xai_daily_budget >= 0 AND xai_daily_budget <= 100000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_xai_rate_limit'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_xai_rate_limit
      CHECK (xai_rate_limit_per_minute >= 1 AND xai_rate_limit_per_minute <= 1000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_xai_budget_alert'
      AND conrelid = 'shop_ai_credentials'::regclass
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT chk_xai_budget_alert
      CHECK (xai_budget_alert_threshold >= 0.50 AND xai_budget_alert_threshold <= 0.99);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shop_ai_credentials_xai_connection_status_check'
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT shop_ai_credentials_xai_connection_status_check
      CHECK (xai_connection_status IN ('unknown', 'connected', 'error', 'disabled', 'missing_key', 'pending'));
  END IF;
END $$;

COMMENT ON COLUMN shop_ai_credentials.xai_api_key_ciphertext IS 'AES-256-GCM encrypted xAI API key';
COMMENT ON COLUMN shop_ai_credentials.xai_enabled IS 'Enable xAI Grok for AI auditor';
