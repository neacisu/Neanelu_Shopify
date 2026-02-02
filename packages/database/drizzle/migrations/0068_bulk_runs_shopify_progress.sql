-- Migration: 0068_bulk_runs_shopify_progress.sql
-- Purpose: Persist Shopify bulk progress fields in bulk_runs

ALTER TABLE bulk_runs
  ADD COLUMN IF NOT EXISTS shopify_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS shopify_error_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shopify_object_count BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_root_object_count BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN bulk_runs.shopify_status IS 'Latest Shopify bulk operation status';
COMMENT ON COLUMN bulk_runs.shopify_error_code IS 'Latest Shopify bulk operation error code';
COMMENT ON COLUMN bulk_runs.shopify_object_count IS 'Shopify objectCount (total objects processed)';
COMMENT ON COLUMN bulk_runs.shopify_root_object_count IS 'Shopify rootObjectCount (root objects only)';
COMMENT ON COLUMN bulk_runs.shopify_file_size_bytes IS 'Shopify bulk result file size in bytes';
COMMENT ON COLUMN bulk_runs.shopify_updated_at IS 'Timestamp of last Shopify bulk status poll';
