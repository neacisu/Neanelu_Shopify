-- Migration: 0012_job_tracking.sql
-- PR-011: Job Tracking Tables
-- Description: BullMQ job tracking and scheduled tasks
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module G: Queue & Job Tracking

-- ============================================
-- Table: job_runs
-- ============================================
CREATE TABLE job_runs (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    queue_name VARCHAR(100) NOT NULL,
    job_id VARCHAR(255) NOT NULL,
    job_name VARCHAR(100) NOT NULL,
    group_id VARCHAR(100),  -- For grouped jobs
    status VARCHAR(20) NOT NULL,  -- waiting/active/completed/failed
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    payload JSONB NOT NULL,
    result JSONB,
    error_message TEXT,
    error_stack TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for job_runs
-- ============================================
CREATE INDEX idx_jobs_queue ON job_runs(queue_name, status);
CREATE INDEX idx_jobs_shop ON job_runs(shop_id, status);
CREATE INDEX idx_jobs_bullmq ON job_runs(queue_name, job_id);
CREATE INDEX idx_jobs_shop_created ON job_runs(shop_id, created_at DESC);
CREATE INDEX idx_jobs_group_status ON job_runs(group_id, status) WHERE group_id IS NOT NULL;

-- ============================================
-- RLS Policy for job_runs
-- ============================================
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_job_runs ON job_runs
    USING (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Table: scheduled_tasks
-- ============================================
CREATE TABLE scheduled_tasks (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    task_name VARCHAR(100) NOT NULL,
    cron_expression VARCHAR(100) NOT NULL,
    queue_name VARCHAR(100) NOT NULL,
    job_data JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    run_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for scheduled_tasks
-- ============================================
CREATE INDEX idx_scheduled_shop ON scheduled_tasks(shop_id);
CREATE INDEX idx_scheduled_active ON scheduled_tasks(is_active, next_run_at) WHERE is_active = true;
CREATE UNIQUE INDEX idx_scheduled_shop_task ON scheduled_tasks(shop_id, task_name);

-- ============================================
-- RLS Policy for scheduled_tasks
-- ============================================
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_scheduled_tasks ON scheduled_tasks
    USING (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE job_runs IS 'BullMQ job execution tracking';
COMMENT ON TABLE scheduled_tasks IS 'Cron-based scheduled task definitions';
COMMENT ON COLUMN job_runs.status IS 'waiting, active, completed, failed';
