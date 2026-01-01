-- Migration: 0039_create_refresh_mv_function.sql
-- Epic 1, Task 1.8: Function to refresh all MVs
-- Called by external scheduler (pg_cron or application scheduler)

CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TABLE (
  view_name text,
  refresh_status text,
  refresh_time timestamptz
) AS $$
DECLARE
  v_start timestamptz;
  v_views text[] := ARRAY[
    'mv_shop_summary',
    'mv_low_stock_alerts', 
    'mv_top_sellers',
    'mv_pim_quality_progress',
    'mv_pim_enrichment_status',
    'mv_pim_source_performance',
    'mv_inventory_current'
  ];
  v_view text;
BEGIN
  FOREACH v_view IN ARRAY v_views LOOP
    v_start := clock_timestamp();
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_view);
      RETURN QUERY SELECT v_view, 'success'::text, clock_timestamp();
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_view, ('error: ' || SQLERRM)::text, clock_timestamp();
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Individual refresh functions for granular scheduling
CREATE OR REPLACE FUNCTION refresh_mv_high_frequency()
RETURNS void AS $$
BEGIN
  -- Every 5-15 minutes
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_current;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_low_stock_alerts;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_mv_hourly()
RETURNS void AS $$
BEGIN
  -- Every hour
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_quality_progress;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_enrichment_status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_mv_daily()
RETURNS void AS $$
BEGIN
  -- Once per day (off-peak hours)
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_sellers;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_source_performance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_all_materialized_views IS 'Refreshes all MVs with error handling. Returns status per view.';
COMMENT ON FUNCTION refresh_mv_high_frequency IS 'Refresh every 5-15 min: inventory, low_stock';
COMMENT ON FUNCTION refresh_mv_hourly IS 'Refresh hourly: shop_summary, pim_quality, enrichment';
COMMENT ON FUNCTION refresh_mv_daily IS 'Refresh daily: top_sellers, source_performance';
