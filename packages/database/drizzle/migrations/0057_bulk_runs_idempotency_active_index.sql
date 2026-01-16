-- Migration: 0057_bulk_runs_idempotency_active_index.sql
-- Purpose: Align bulk_runs idempotency with active-only uniqueness (F5.1.2)

-- Drop global uniqueness (allow historical re-runs with same idempotency_key)
ALTER TABLE bulk_runs DROP CONSTRAINT IF EXISTS bulk_runs_idempotency_key_unique;
DROP INDEX IF EXISTS idx_bulk_runs_idempotency;

-- Keep fast lookups for idempotency key
CREATE INDEX IF NOT EXISTS idx_bulk_runs_idempotency
  ON bulk_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Enforce active-only idempotency per shop
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_runs_active_idempotency
  ON bulk_runs(shop_id, idempotency_key)
  WHERE status IN ('pending', 'running');

COMMENT ON INDEX idx_bulk_runs_active_idempotency IS
  'Prevents duplicate active bulk runs for the same shop + idempotency key';
