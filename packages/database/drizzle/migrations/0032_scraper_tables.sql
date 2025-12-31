-- Migration: 0032_scraper_tables.sql
-- Purpose: Add scraper_configs, scraper_runs, scraper_queue tables

-- ============================================
-- Table: scraper_configs
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_configs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  source_id UUID NOT NULL REFERENCES prod_sources(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  scraper_type VARCHAR(50) NOT NULL,
  target_url_pattern TEXT NOT NULL,
  selectors JSONB NOT NULL,
  pagination_config JSONB,
  rate_limit JSONB,
  retry_config JSONB,
  headers JSONB DEFAULT '{}',
  cookies JSONB DEFAULT '{}',
  proxy_config JSONB,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  success_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_scraper_type CHECK (scraper_type IN ('CHEERIO', 'PLAYWRIGHT', 'PUPPETEER'))
);

CREATE INDEX idx_scraper_configs_source ON scraper_configs(source_id);
CREATE INDEX idx_scraper_configs_active ON scraper_configs(is_active, scraper_type);

CREATE TRIGGER trg_scraper_configs_updated_at
  BEFORE UPDATE ON scraper_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: scraper_runs
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  config_id UUID NOT NULL REFERENCES scraper_configs(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES prod_sources(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  trigger_type VARCHAR(30),
  target_urls TEXT[],
  pages_crawled INTEGER DEFAULT 0,
  products_found INTEGER DEFAULT 0,
  products_updated INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  memory_peak_mb INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_scraper_run_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX idx_scraper_runs_config ON scraper_runs(config_id, created_at DESC);
CREATE INDEX idx_scraper_runs_status ON scraper_runs(status, created_at DESC);
CREATE INDEX idx_scraper_runs_source ON scraper_runs(source_id, created_at DESC);

-- ============================================
-- Table: scraper_queue
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_queue (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  config_id UUID NOT NULL REFERENCES scraper_configs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  depth INTEGER DEFAULT 0,
  parent_url TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX idx_scraper_queue_pending ON scraper_queue(config_id, priority DESC, created_at) WHERE status = 'pending';
CREATE INDEX idx_scraper_queue_url ON scraper_queue(url);
CREATE INDEX idx_scraper_queue_next ON scraper_queue(next_attempt_at) WHERE status = 'pending';
