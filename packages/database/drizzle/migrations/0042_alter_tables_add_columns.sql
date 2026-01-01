-- Migration: 0042_alter_tables_add_columns.sql
-- Epic 4: Add missing columns to existing tables

-- ============================================
-- SECTION 1: shops table
-- ============================================

ALTER TABLE shops ADD COLUMN IF NOT EXISTS needs_reauth boolean DEFAULT false;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS uninstalled_at timestamptz;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS reinstalled_count int DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS api_call_count_daily int DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS api_call_reset_at timestamptz DEFAULT NOW();

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_shops_needs_reauth ON shops(needs_reauth) WHERE needs_reauth = true;
CREATE INDEX IF NOT EXISTS idx_shops_uninstalled ON shops(uninstalled_at) WHERE uninstalled_at IS NOT NULL;

-- ============================================
-- SECTION 2: bulk_runs table
-- ============================================

ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS polling_url text;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS result_url text;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS result_size_bytes bigint;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS polling_attempts int DEFAULT 0;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS partial_data_url text;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cursor_position text;

-- ============================================
-- SECTION 3: prod_sources table
-- ============================================

-- Add shop_id for potential per-shop source tracking
ALTER TABLE prod_sources ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES shops(id);
ALTER TABLE prod_sources ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE prod_sources ADD COLUMN IF NOT EXISTS enrichment_version int DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_prod_sources_shop ON prod_sources(shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prod_sources_enriched ON prod_sources(enriched_at) WHERE enriched_at IS NOT NULL;

-- ============================================
-- SECTION 4: prod_raw_harvest table
-- ============================================

ALTER TABLE prod_raw_harvest ADD COLUMN IF NOT EXISTS processing_time_ms int;
ALTER TABLE prod_raw_harvest ADD COLUMN IF NOT EXISTS error_message text;

-- ============================================
-- SECTION 5: job_runs table (if missing columns)
-- ============================================

ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS group_id text;
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS priority int DEFAULT 5;
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS parent_job_id uuid REFERENCES job_runs(id);

CREATE INDEX IF NOT EXISTS idx_job_runs_group_status ON job_runs(group_id, status) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_runs_priority ON job_runs(priority, created_at) WHERE status = 'pending';
