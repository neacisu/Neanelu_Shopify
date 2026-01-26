CREATE TABLE embedding_backfill_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending, running, paused, completed, failed

  total_products INTEGER DEFAULT 0,
  processed_products INTEGER DEFAULT 0,
  failed_products INTEGER DEFAULT 0,

  last_product_id UUID,
  daily_items_processed INTEGER DEFAULT 0,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_backfill_runs_shop ON embedding_backfill_runs (shop_id);
CREATE INDEX idx_backfill_runs_status ON embedding_backfill_runs (status)
  WHERE status IN ('running', 'paused');
