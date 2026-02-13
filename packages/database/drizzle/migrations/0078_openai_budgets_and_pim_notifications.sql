-- Migration: 0078_openai_budgets_and_pim_notifications.sql
-- Purpose:
-- 1) Add OpenAI per-shop budget columns
-- 2) Add in-app PIM notifications table
-- 3) Add consolidated budget status view for observability

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS openai_daily_budget NUMERIC(10,2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS openai_budget_alert_threshold NUMERIC(3,2) DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS openai_items_daily_budget INTEGER DEFAULT 100000;

CREATE TABLE IF NOT EXISTS pim_notifications (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  body JSONB NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pim_notifications_shop
  ON pim_notifications(shop_id, created_at DESC);

ALTER TABLE pim_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pim_notifications'
      AND policyname = 'pim_notifications_tenant'
  ) THEN
    CREATE POLICY pim_notifications_tenant ON pim_notifications
      USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE pim_notifications FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW v_api_budget_status AS
SELECT
  sac.shop_id,
  sac.serper_daily_budget AS serper_limit,
  COALESCE(serper_usage.used_requests, 0) AS serper_used,
  CASE
    WHEN sac.serper_daily_budget > 0
      THEN COALESCE(serper_usage.used_requests, 0)::numeric / sac.serper_daily_budget::numeric
    ELSE 0
  END AS serper_ratio,
  sac.serper_budget_alert_threshold AS serper_threshold,
  sac.xai_daily_budget AS xai_limit,
  COALESCE(xai_usage.used_cost, 0) AS xai_used,
  CASE
    WHEN sac.xai_daily_budget > 0
      THEN COALESCE(xai_usage.used_cost, 0) / sac.xai_daily_budget::numeric
    ELSE 0
  END AS xai_ratio,
  sac.xai_budget_alert_threshold AS xai_threshold,
  sac.openai_daily_budget AS openai_cost_limit,
  COALESCE(openai_usage.used_cost, 0) AS openai_cost_used,
  CASE
    WHEN sac.openai_daily_budget > 0
      THEN COALESCE(openai_usage.used_cost, 0) / sac.openai_daily_budget
    ELSE 0
  END AS openai_cost_ratio,
  sac.openai_items_daily_budget AS openai_items_limit,
  COALESCE(openai_usage.used_items, 0) AS openai_items_used,
  CASE
    WHEN sac.openai_items_daily_budget > 0
      THEN COALESCE(openai_usage.used_items, 0)::numeric / sac.openai_items_daily_budget::numeric
    ELSE 0
  END AS openai_items_ratio,
  sac.openai_budget_alert_threshold AS openai_threshold
FROM shop_ai_credentials sac
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(request_count), 0) AS used_requests
  FROM api_usage_log
  WHERE api_provider = 'serper'
    AND shop_id = sac.shop_id
    AND created_at >= date_trunc('day', now())
    AND created_at < date_trunc('day', now()) + interval '1 day'
) serper_usage ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(estimated_cost), 0) AS used_cost
  FROM api_usage_log
  WHERE api_provider = 'xai'
    AND shop_id = sac.shop_id
    AND created_at >= date_trunc('day', now())
    AND created_at < date_trunc('day', now()) + interval '1 day'
) xai_usage ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(estimated_cost), 0) AS used_cost,
    COALESCE(SUM(request_count), 0) AS used_items
  FROM api_usage_log
  WHERE api_provider = 'openai'
    AND shop_id = sac.shop_id
    AND created_at >= date_trunc('day', now())
    AND created_at < date_trunc('day', now()) + interval '1 day'
) openai_usage ON true;
