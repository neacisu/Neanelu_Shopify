-- Migration: 0028_sync_checkpoints.sql
-- Purpose: Add sync_checkpoints table for tracking sync progress

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  last_sync_at TIMESTAMPTZ NOT NULL,
  last_cursor VARCHAR(255),
  records_synced INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'idle',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_sync_status CHECK (status IN ('idle', 'running', 'error'))
);

CREATE UNIQUE INDEX idx_checkpoints_shop_resource ON sync_checkpoints(shop_id, resource_type);

-- RLS
ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_checkpoints_tenant_isolation ON sync_checkpoints
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE sync_checkpoints FORCE ROW LEVEL SECURITY;

CREATE TRIGGER trg_sync_checkpoints_updated_at
  BEFORE UPDATE ON sync_checkpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
