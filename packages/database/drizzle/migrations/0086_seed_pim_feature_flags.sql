-- ============================================
-- Migration: 0086_seed_pim_feature_flags.sql
-- Purpose: Ensure PIM pipeline feature flags exist with safe defaults
-- ============================================

INSERT INTO feature_flags (flag_key, description, default_value, is_active, rollout_percentage)
VALUES
  (
    'bulk.pim_sync.enabled',
    'Enable PIM sync after bulk ingestion (GTIN matching, semantic dedup, prod_master creation)',
    true,
    true,
    100
  ),
  (
    'bulk.semantic_dedup.enabled',
    'Enable semantic deduplication via embeddings during PIM sync',
    true,
    true,
    100
  ),
  (
    'bulk.consensus.enabled',
    'Enable consensus job dispatch after PIM sync; disabled initially to avoid empty consensus queue',
    false,
    true,
    100
  )
ON CONFLICT (flag_key)
DO UPDATE SET
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value,
  is_active = EXCLUDED.is_active,
  rollout_percentage = EXCLUDED.rollout_percentage,
  updated_at = now();
