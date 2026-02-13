export const MV_REFRESH_SCHEDULE = {
  mv_pim_quality_progress: '5 * * * *',
  mv_pim_enrichment_status: '5 * * * *',
  mv_pim_source_performance: '5 2 * * *',
} as const;

export const MV_REFRESH_FUNCTIONS = {
  hourly: 'refresh_mv_hourly',
  daily: 'refresh_mv_daily',
  all: 'refresh_all_materialized_views',
} as const;

export type MvName = keyof typeof MV_REFRESH_SCHEDULE;
