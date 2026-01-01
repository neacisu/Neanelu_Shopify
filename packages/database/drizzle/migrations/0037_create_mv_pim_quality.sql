-- Migration: 0037_create_mv_pim_quality.sql (CORRECTED)
-- Epic 1, Task 1.4-1.5: PIM quality level distribution and enrichment status
-- Refresh: Hourly via external scheduler

-- MV 1: Quality Progress
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pim_quality_progress AS
SELECT
  data_quality_level,
  COUNT(*) as product_count,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) as percentage,
  AVG(quality_score) as avg_quality_score,
  COUNT(*) FILTER (WHERE needs_review = true) as needs_review_count,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '24 hours') as promoted_to_silver_24h,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '24 hours') as promoted_to_golden_24h,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '7 days') as promoted_to_silver_7d,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '7 days') as promoted_to_golden_7d,
  MAX(updated_at) as last_update,
  NOW() as refreshed_at
FROM prod_master
GROUP BY data_quality_level;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pim_quality_level ON mv_pim_quality_progress(data_quality_level);

COMMENT ON MATERIALIZED VIEW mv_pim_quality_progress IS 'PIM quality level distribution. Refresh hourly.';

-- MV 2: Enrichment Status (based on prod_channel_mappings with CORRECT columns)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pim_enrichment_status AS
SELECT
  pm.data_quality_level,
  COALESCE(pcm.channel, 'unknown') as channel,
  COUNT(DISTINCT pm.id) as product_count,
  COUNT(DISTINCT pm.id) FILTER (WHERE pcm.last_pushed_at IS NOT NULL) as synced_count,
  ROUND(
    COUNT(DISTINCT pm.id) FILTER (WHERE pcm.last_pushed_at IS NOT NULL)::numeric / 
    NULLIF(COUNT(DISTINCT pm.id)::numeric, 0) * 100, 2
  ) as sync_rate,
  AVG(pm.quality_score) as avg_quality_score,
  NOW() as refreshed_at
FROM prod_master pm
LEFT JOIN prod_channel_mappings pcm ON pcm.product_id = pm.id
GROUP BY pm.data_quality_level, pcm.channel;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pim_enrichment_pk ON mv_pim_enrichment_status(data_quality_level, channel);

COMMENT ON MATERIALIZED VIEW mv_pim_enrichment_status IS 'PIM enrichment status by channel. Refresh hourly.';
