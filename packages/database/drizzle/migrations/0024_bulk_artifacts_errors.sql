-- Migration: 0024_bulk_artifacts_errors.sql
-- Purpose: Add bulk_artifacts and bulk_errors tables

-- ============================================
-- Table: bulk_artifacts
-- ============================================
CREATE TABLE IF NOT EXISTS bulk_artifacts (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  artifact_type VARCHAR(50) NOT NULL,
  file_path TEXT NOT NULL,
  url TEXT,
  bytes_size BIGINT,
  rows_count INTEGER,
  checksum VARCHAR(64),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bulk_artifacts_run ON bulk_artifacts(bulk_run_id);

-- RLS
ALTER TABLE bulk_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_artifacts_tenant_isolation ON bulk_artifacts
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE bulk_artifacts FORCE ROW LEVEL SECURITY;

-- ============================================
-- Table: bulk_errors
-- ============================================
CREATE TABLE IF NOT EXISTS bulk_errors (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  bulk_run_id UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  error_type VARCHAR(50) NOT NULL,
  error_code VARCHAR(50),
  error_message TEXT NOT NULL,
  line_number INTEGER,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bulk_errors_run ON bulk_errors(bulk_run_id);
CREATE INDEX idx_bulk_errors_type ON bulk_errors(shop_id, error_type);

-- RLS
ALTER TABLE bulk_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_errors_tenant_isolation ON bulk_errors
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE bulk_errors FORCE ROW LEVEL SECURITY;
