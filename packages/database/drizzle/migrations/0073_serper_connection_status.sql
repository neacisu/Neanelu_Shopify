ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS serper_connection_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS serper_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serper_last_error TEXT,
  ADD COLUMN IF NOT EXISTS serper_last_success_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shop_ai_credentials_serper_connection_status_check'
  ) THEN
    ALTER TABLE shop_ai_credentials
      ADD CONSTRAINT shop_ai_credentials_serper_connection_status_check
      CHECK (serper_connection_status IN ('unknown', 'connected', 'error', 'disabled', 'missing_key', 'pending'));
  END IF;
END $$;
