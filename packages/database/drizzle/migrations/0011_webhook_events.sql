-- Migration: 0011_webhook_events.sql
-- PR-011: F2.2.9 - Webhook Events Partitioned
-- Description: Async webhook processing queue with monthly partitions
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module B: Shopify Mirror
-- PARTITIONING: RANGE on created_at (monthly)

-- ============================================
-- Table: webhook_events (PARTITIONED)
-- ============================================
CREATE TABLE webhook_events (
    id UUID DEFAULT uuidv7(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    topic VARCHAR(100) NOT NULL,
    shopify_webhook_id VARCHAR(100),
    api_version VARCHAR(20),
    payload JSONB NOT NULL,
    hmac_verified BOOLEAN NOT NULL DEFAULT false,
    received_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    job_id VARCHAR(255),
    idempotency_key VARCHAR(255),
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ============================================
-- Monthly Partitions for 2025
-- ============================================
CREATE TABLE webhook_events_2025_01 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE webhook_events_2025_02 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE webhook_events_2025_03 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE webhook_events_2025_04 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE webhook_events_2025_05 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE webhook_events_2025_06 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE webhook_events_2025_07 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE webhook_events_2025_08 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE webhook_events_2025_09 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE webhook_events_2025_10 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE webhook_events_2025_11 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE webhook_events_2025_12 PARTITION OF webhook_events
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_webhook_events_unprocessed ON webhook_events(shop_id, received_at) 
    WHERE processed_at IS NULL;
CREATE INDEX idx_webhook_events_topic ON webhook_events(shop_id, topic);
-- Note: For partitioned tables, UNIQUE indexes must include all partition columns
-- Using regular index instead of UNIQUE since idempotency is enforced at application level
CREATE INDEX idx_webhook_events_idempotency ON webhook_events(idempotency_key, created_at) 
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_webhook_events_payload ON webhook_events USING GIN(payload jsonb_path_ops);
CREATE INDEX idx_webhook_events_job ON webhook_events(job_id) WHERE job_id IS NOT NULL;

-- ============================================
-- RLS Policy
-- ============================================
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhook_events ON webhook_events
    USING (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE webhook_events IS 'Async webhook processing queue - partitioned monthly for retention management';
COMMENT ON COLUMN webhook_events.hmac_verified IS 'HMAC-SHA256 validation passed';
COMMENT ON COLUMN webhook_events.idempotency_key IS 'X-Shopify-Webhook-Id for deduplication';
