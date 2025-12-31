-- Migration: 0027_ai_batches.sql
-- Purpose: Add ai_batches and ai_batch_items tables for AI processing

-- ============================================
-- Table: ai_batches
-- ============================================
CREATE TABLE IF NOT EXISTS ai_batches (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  provider_batch_id VARCHAR(100),
  batch_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  request_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost DECIMAL(10,4),
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_ai_batch_provider CHECK (provider IN ('openai', 'anthropic', 'google')),
  CONSTRAINT chk_ai_batch_type CHECK (batch_type IN ('embedding', 'extraction', 'enrichment', 'translation')),
  CONSTRAINT chk_ai_batch_status CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed'))
);

CREATE INDEX idx_ai_batches_provider ON ai_batches(provider_batch_id);
CREATE INDEX idx_ai_batches_status ON ai_batches(status);
CREATE INDEX idx_ai_batches_shop ON ai_batches(shop_id);

CREATE TRIGGER trg_ai_batches_updated_at
  BEFORE UPDATE ON ai_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: ai_batch_items
-- ============================================
CREATE TABLE IF NOT EXISTS ai_batch_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  batch_id UUID NOT NULL REFERENCES ai_batches(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  custom_id VARCHAR(100),
  input_content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  output_content TEXT,
  tokens_used INTEGER,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_ai_item_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX idx_batch_items_batch ON ai_batch_items(batch_id);
CREATE INDEX idx_batch_items_entity ON ai_batch_items(entity_type, entity_id);
CREATE INDEX idx_batch_items_hash ON ai_batch_items(content_hash);
CREATE INDEX idx_batch_items_status ON ai_batch_items(batch_id, status);
