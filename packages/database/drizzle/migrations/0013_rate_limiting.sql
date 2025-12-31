-- Migration: 0013_rate_limiting.sql
-- PR-011: F2.2.10 - Rate Limiting Tables
-- Description: Token bucket for distributed rate limiting
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module G: Queue & Job Tracking
-- PARTITIONING: api_cost_tracking uses monthly partitions

-- ============================================
-- Table: rate_limit_buckets
-- Token bucket for Shopify API rate limiting
-- ============================================
CREATE TABLE rate_limit_buckets (
    shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
    tokens_remaining DECIMAL(10,2) NOT NULL DEFAULT 1000,
    max_tokens DECIMAL(10,2) NOT NULL DEFAULT 1000,
    refill_rate DECIMAL(10,4) NOT NULL DEFAULT 2.0,  -- tokens per second
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    consecutive_429_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- NOTE: No RLS needed - shop_id is PK, queries always filter by shop_id

-- ============================================
-- Table: api_cost_tracking (PARTITIONED)
-- GraphQL query cost tracking
-- ============================================
CREATE TABLE api_cost_tracking (
    id UUID DEFAULT uuidv7(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL,
    query_hash VARCHAR(64),
    actual_cost INTEGER NOT NULL,
    throttle_status VARCHAR(20),  -- THROTTLED, OK
    available_cost INTEGER,
    restore_rate DECIMAL(10,2),
    requested_at TIMESTAMPTZ DEFAULT now(),
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ============================================
-- Monthly Partitions for api_cost_tracking 2025
-- ============================================
CREATE TABLE api_cost_tracking_2025_01 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE api_cost_tracking_2025_02 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE api_cost_tracking_2025_03 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE api_cost_tracking_2025_04 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE api_cost_tracking_2025_05 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE api_cost_tracking_2025_06 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE api_cost_tracking_2025_07 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE api_cost_tracking_2025_08 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE api_cost_tracking_2025_09 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE api_cost_tracking_2025_10 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE api_cost_tracking_2025_11 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE api_cost_tracking_2025_12 PARTITION OF api_cost_tracking
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_api_cost_shop_date ON api_cost_tracking(shop_id, requested_at DESC);
CREATE INDEX idx_api_cost_throttled ON api_cost_tracking(shop_id, throttle_status) 
    WHERE throttle_status IS NOT NULL;
CREATE INDEX idx_api_cost_query_hash ON api_cost_tracking(query_hash) 
    WHERE query_hash IS NOT NULL;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE rate_limit_buckets IS 'Token bucket for Shopify API rate limiting - one row per shop';
COMMENT ON TABLE api_cost_tracking IS 'GraphQL query cost tracking - partitioned monthly, 7-day retention recommended';
COMMENT ON COLUMN rate_limit_buckets.refill_rate IS 'Tokens restored per second (Shopify default: 2/s)';
COMMENT ON COLUMN rate_limit_buckets.consecutive_429_count IS 'Consecutive 429 responses for back-off calculation';
