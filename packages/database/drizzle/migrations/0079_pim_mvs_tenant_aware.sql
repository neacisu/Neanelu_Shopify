-- Migration: 0079_pim_mvs_tenant_aware.sql
-- Purpose: make PR-062 PIM MVs tenant-aware by shop_id

DROP MATERIALIZED VIEW IF EXISTS mv_pim_enrichment_status;
DROP MATERIALIZED VIEW IF EXISTS mv_pim_source_performance;
DROP MATERIALIZED VIEW IF EXISTS mv_pim_quality_progress;

CREATE MATERIALIZED VIEW mv_pim_quality_progress AS
WITH scoped_products AS (
  SELECT DISTINCT
    pcm.shop_id,
    pm.id AS product_id,
    pm.data_quality_level,
    pm.quality_score,
    pm.needs_review,
    pm.promoted_to_silver_at,
    pm.promoted_to_golden_at,
    pm.updated_at
  FROM prod_channel_mappings pcm
  JOIN prod_master pm ON pm.id = pcm.product_id
  WHERE pcm.shop_id IS NOT NULL
    AND pcm.channel = 'shopify'
)
SELECT
  shop_id,
  data_quality_level,
  COUNT(*) AS product_count,
  ROUND(
    COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY shop_id), 0) * 100,
    2
  ) AS percentage,
  AVG(quality_score) AS avg_quality_score,
  COUNT(*) FILTER (WHERE needs_review = true) AS needs_review_count,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '24 hours') AS promoted_to_silver_24h,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '24 hours') AS promoted_to_golden_24h,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '7 days') AS promoted_to_silver_7d,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '7 days') AS promoted_to_golden_7d,
  MAX(updated_at) AS last_update,
  NOW() AS refreshed_at
FROM scoped_products
GROUP BY shop_id, data_quality_level;

CREATE UNIQUE INDEX idx_mv_pim_quality_shop_level
  ON mv_pim_quality_progress(shop_id, data_quality_level);

COMMENT ON MATERIALIZED VIEW mv_pim_quality_progress IS
  'PIM quality distribution per shop. Refresh hourly.';

CREATE MATERIALIZED VIEW mv_pim_enrichment_status AS
WITH channel_products AS (
  SELECT DISTINCT
    pcm.shop_id,
    COALESCE(pcm.channel, 'unknown') AS channel,
    pcm.product_id,
    (pcm.last_pushed_at IS NOT NULL) AS is_synced
  FROM prod_channel_mappings pcm
  WHERE pcm.shop_id IS NOT NULL
)
SELECT
  cp.shop_id,
  pm.data_quality_level,
  cp.channel,
  COUNT(*) AS product_count,
  COUNT(*) FILTER (WHERE cp.is_synced) AS synced_count,
  ROUND(
    COUNT(*) FILTER (WHERE cp.is_synced)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100,
    2
  ) AS sync_rate,
  AVG(pm.quality_score) AS avg_quality_score,
  NOW() AS refreshed_at
FROM channel_products cp
JOIN prod_master pm ON pm.id = cp.product_id
GROUP BY cp.shop_id, pm.data_quality_level, cp.channel;

CREATE UNIQUE INDEX idx_mv_pim_enrichment_shop_pk
  ON mv_pim_enrichment_status(shop_id, data_quality_level, channel);

COMMENT ON MATERIALIZED VIEW mv_pim_enrichment_status IS
  'PIM enrichment sync status per shop and channel. Refresh hourly.';

CREATE MATERIALIZED VIEW mv_pim_source_performance AS
SELECT
  ps.shop_id,
  ps.id AS source_id,
  ps.source_type,
  ps.name AS source_name,
  COUNT(prh.id) AS total_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'completed') AS successful_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'pending') AS pending_harvests,
  COUNT(prh.id) FILTER (WHERE prh.processing_status = 'failed') AS failed_harvests,
  ROUND(
    COUNT(prh.id) FILTER (WHERE prh.processing_status = 'completed')::numeric /
    NULLIF(COUNT(prh.id)::numeric, 0) * 100,
    2
  ) AS success_rate,
  ps.trust_score,
  ps.is_active,
  MAX(prh.fetched_at) AS last_harvest_at,
  NOW() AS refreshed_at
FROM prod_sources ps
LEFT JOIN prod_raw_harvest prh ON prh.source_id = ps.id
GROUP BY ps.shop_id, ps.id, ps.source_type, ps.name, ps.trust_score, ps.is_active;

CREATE UNIQUE INDEX idx_mv_pim_source_perf_shop_pk
  ON mv_pim_source_performance(shop_id, source_id);

COMMENT ON MATERIALIZED VIEW mv_pim_source_performance IS
  'Source harvest performance per shop. Refresh daily.';
