-- Migration: 0059_bulk_schedules.sql
-- Purpose: Add bulk_schedules table for ingestion scheduling

-- ============================================
-- Table: bulk_schedules
-- ============================================
CREATE TABLE IF NOT EXISTS bulk_schedules (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bulk_schedules_shop ON bulk_schedules(shop_id);

-- RLS
ALTER TABLE bulk_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_schedules_tenant_isolation ON bulk_schedules
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE bulk_schedules FORCE ROW LEVEL SECURITY;
