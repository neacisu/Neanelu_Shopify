-- Migration: 0016_embedding_batches.sql
-- PR-011: F2.2.17 - Embedding Batches
-- Description: OpenAI Batch Embeddings API tracking
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module F: AI Batch Processing

-- ============================================
-- Table: embedding_batches
-- ============================================
CREATE TABLE embedding_batches (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    batch_type VARCHAR(30) NOT NULL CHECK (batch_type IN ('product_title', 'product_description', 'specs', 'combined', 'attribute')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'cancelled')),
    openai_batch_id VARCHAR(100),
    input_file_id VARCHAR(100),
    output_file_id VARCHAR(100),
    error_file_id VARCHAR(100),
    model VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
    dimensions INTEGER NOT NULL DEFAULT 1536,
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10,4),
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_embedding_batches_shop ON embedding_batches(shop_id);
CREATE INDEX idx_embedding_batches_status ON embedding_batches(status);
CREATE INDEX idx_embedding_batches_openai ON embedding_batches(openai_batch_id) 
    WHERE openai_batch_id IS NOT NULL;

-- ============================================
-- RLS Policy
-- ============================================
ALTER TABLE embedding_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_batches FORCE ROW LEVEL SECURITY;

-- Global batches (shop_id IS NULL) are readable by all; tenant batches are isolated
CREATE POLICY tenant_isolation_embedding_batches ON embedding_batches
    USING (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WITH CHECK (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting('app.current_shop_id', true), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE embedding_batches IS 'OpenAI Batch Embeddings API job tracking';
COMMENT ON COLUMN embedding_batches.batch_type IS 'product_title, product_description, specs, combined, attribute';
COMMENT ON COLUMN embedding_batches.dimensions IS 'Embedding dimensions: 1536 for text-embedding-3-small';
COMMENT ON COLUMN embedding_batches.openai_batch_id IS 'OpenAI batch ID for polling status';
