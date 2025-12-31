-- Migration: 0033_api_usage_analytics.sql
-- Purpose: Add api_usage_log and analytics_daily_shop tables

-- ============================================
-- Table: api_usage_log
-- ============================================
CREATE TABLE IF NOT EXISTS api_usage_log (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  api_provider VARCHAR(50) NOT NULL,
  endpoint VARCHAR(100) NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  tokens_input INTEGER,
  tokens_output INTEGER,
  estimated_cost DECIMAL(10,4),
  http_status INTEGER,
  response_time_ms INTEGER,
  job_id VARCHAR(255),
  product_id UUID REFERENCES prod_master(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_usage_provider_date ON api_usage_log(api_provider, created_at);
CREATE INDEX idx_api_usage_product ON api_usage_log(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_api_usage_shop ON api_usage_log(shop_id, created_at) WHERE shop_id IS NOT NULL;
CREATE INDEX idx_api_usage_cost ON api_usage_log(created_at, estimated_cost) WHERE estimated_cost > 0;
CREATE INDEX idx_api_usage_errors ON api_usage_log(api_provider, created_at) WHERE http_status >= 400;

-- ============================================
-- Table: analytics_daily_shop
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_daily_shop (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  orders_count INTEGER DEFAULT 0,
  orders_total DECIMAL(14,2) DEFAULT 0,
  orders_avg DECIMAL(12,2) DEFAULT 0,
  products_synced INTEGER DEFAULT 0,
  variants_synced INTEGER DEFAULT 0,
  customers_new INTEGER DEFAULT 0,
  inventory_value DECIMAL(14,2) DEFAULT 0,
  low_stock_count INTEGER DEFAULT 0,
  out_of_stock_count INTEGER DEFAULT 0,
  bulk_runs_count INTEGER DEFAULT 0,
  bulk_runs_failed INTEGER DEFAULT 0,
  api_calls_count INTEGER DEFAULT 0,
  webhook_events_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_analytics_daily_shop_date ON analytics_daily_shop(shop_id, date);
CREATE INDEX idx_analytics_daily_date ON analytics_daily_shop(date);

ALTER TABLE analytics_daily_shop ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_daily_shop_tenant_isolation ON analytics_daily_shop
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE analytics_daily_shop FORCE ROW LEVEL SECURITY;

-- ============================================
-- View: v_api_daily_costs
-- ============================================
CREATE OR REPLACE VIEW v_api_daily_costs AS
SELECT 
  DATE(created_at) as date,
  api_provider,
  SUM(request_count) as total_requests,
  SUM(tokens_input) as total_input_tokens,
  SUM(tokens_output) as total_output_tokens,
  SUM(estimated_cost) as total_cost,
  COUNT(*) FILTER (WHERE http_status >= 400) as error_count,
  AVG(response_time_ms) as avg_response_time_ms
FROM api_usage_log
GROUP BY DATE(created_at), api_provider;

-- ============================================
-- Table: analytics_product_performance
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_product_performance (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type VARCHAR(20) NOT NULL,
  views_count INTEGER DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  units_sold INTEGER DEFAULT 0,
  revenue DECIMAL(12,2) DEFAULT 0,
  avg_order_value DECIMAL(12,2) DEFAULT 0,
  return_rate DECIMAL(5,2) DEFAULT 0,
  inventory_turnover DECIMAL(8,4),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_period_type CHECK (period_type IN ('daily', 'weekly', 'monthly'))
);

CREATE INDEX idx_product_perf_product ON analytics_product_performance(product_id, period_type, period_start DESC);
CREATE INDEX idx_product_perf_shop_period ON analytics_product_performance(shop_id, period_type, period_start DESC);
CREATE INDEX idx_product_perf_revenue ON analytics_product_performance(shop_id, period_type, revenue DESC);

ALTER TABLE analytics_product_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_perf_tenant_isolation ON analytics_product_performance
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE analytics_product_performance FORCE ROW LEVEL SECURITY;
