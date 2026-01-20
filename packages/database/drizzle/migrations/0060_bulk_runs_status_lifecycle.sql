-- Migration: 0060_bulk_runs_status_lifecycle.sql
-- Purpose: Expand bulk_runs status lifecycle for polling/downloading/processing

-- ============================================
-- Update status constraint
-- ============================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bulk_status') THEN
    ALTER TABLE bulk_runs DROP CONSTRAINT chk_bulk_status;
  END IF;

  ALTER TABLE bulk_runs ADD CONSTRAINT chk_bulk_status
    CHECK (status IN (
      'pending',
      'running',
      'polling',
      'downloading',
      'processing',
      'completed',
      'failed',
      'cancelled'
    ));
END $$;

-- ============================================
-- Refresh active-only indexes
-- ============================================
DROP INDEX IF EXISTS idx_bulk_runs_active_shop;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_runs_active_shop
  ON bulk_runs(shop_id)
  WHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing');

DROP INDEX IF EXISTS idx_bulk_runs_active_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_runs_active_idempotency
  ON bulk_runs(shop_id, idempotency_key)
  WHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing');

COMMENT ON INDEX idx_bulk_runs_active_shop IS 'Prevents multiple concurrent bulk ops per shop (expanded lifecycle)';
COMMENT ON INDEX idx_bulk_runs_active_idempotency IS 'Prevents duplicate active bulk runs per shop + idempotency key (expanded lifecycle)';
