-- ============================================
-- Migration: 0087_enable_bulk_consensus_flag.sql
-- Purpose: Phase 5 rollout - enable consensus dispatch after enrichment validation
-- ============================================

UPDATE feature_flags
SET
  default_value = true,
  is_active = true,
  rollout_percentage = 100,
  updated_at = now()
WHERE flag_key = 'bulk.consensus.enabled';
