-- Migration: 0080_quality_webhook_config.sql
-- Purpose:
-- 1) Add per-shop quality webhook configuration
-- 2) Add quality webhook delivery log table

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS quality_webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS quality_webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS quality_webhook_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_webhook_events TEXT[] NOT NULL
    DEFAULT ARRAY['quality_promoted', 'quality_demoted', 'review_requested', 'milestone_reached'];

CREATE TABLE IF NOT EXISTS quality_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  event_id UUID NOT NULL REFERENCES prod_quality_events(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  event_type VARCHAR(50),
  http_status INTEGER,
  duration_ms INTEGER,
  response_body TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qwd_event
  ON quality_webhook_deliveries(event_id);

CREATE INDEX IF NOT EXISTS idx_qwd_shop_created
  ON quality_webhook_deliveries(shop_id, created_at DESC);

ALTER TABLE quality_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quality_webhook_deliveries'
      AND policyname = 'quality_webhook_deliveries_tenant'
  ) THEN
    CREATE POLICY quality_webhook_deliveries_tenant ON quality_webhook_deliveries
      USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE quality_webhook_deliveries FORCE ROW LEVEL SECURITY;
