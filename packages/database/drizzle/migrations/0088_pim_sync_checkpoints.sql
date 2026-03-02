-- ============================================
-- Migration: 0088_pim_sync_checkpoints.sql
-- Purpose: Durable checkpoints for PIM sync + rollback consensus flag
-- ============================================

CREATE TABLE IF NOT EXISTS pim_sync_checkpoints (
    id                UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id           UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    bulk_run_id       UUID NOT NULL REFERENCES bulk_runs(id) ON DELETE CASCADE,
    target_product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (bulk_run_id, target_product_id)
);

CREATE INDEX IF NOT EXISTS idx_pim_sync_checkpoints_shop_bulk
  ON pim_sync_checkpoints (shop_id, bulk_run_id);

INSERT INTO pim_sync_checkpoints (shop_id, bulk_run_id, target_product_id)
SELECT sp.shop_id, sp.bulk_run_id, sp.target_product_id
FROM staging_products sp
WHERE sp.validation_status = 'valid'
  AND sp.merge_status = 'merged'
  AND sp.bulk_run_id = (
    SELECT id
    FROM bulk_runs
    WHERE status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  )
ON CONFLICT DO NOTHING;

UPDATE feature_flags
SET default_value = false,
    updated_at = now()
WHERE flag_key = 'bulk.consensus.enabled';
