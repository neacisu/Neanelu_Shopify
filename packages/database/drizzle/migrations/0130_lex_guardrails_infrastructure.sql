-- Migration: lex_guardrails_infrastructure
-- Adds guardrails columns to lex_shop_settings and creates lex_guardrails_events audit table.

-- 1. Guardrails mode and counters on lex_shop_settings
ALTER TABLE lex_shop_settings
  ADD COLUMN IF NOT EXISTS guardrails_lex_mode VARCHAR(20) NOT NULL DEFAULT 'warn',
  ADD COLUMN IF NOT EXISTS guardrails_warn_threshold INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS guardrails_warn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guardrails_block_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guardrails_false_positive_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guardrails_last_evaluated_at TIMESTAMPTZ;

-- guardrails_lex_mode values: 'warn' | 'enforce' | 'progressive'
COMMENT ON COLUMN lex_shop_settings.guardrails_lex_mode IS 'Guardrail enforcement mode: warn (log only), enforce (block), progressive (auto-escalate)';
COMMENT ON COLUMN lex_shop_settings.guardrails_warn_threshold IS 'Number of warnings before auto-switch to enforce (progressive mode)';
COMMENT ON COLUMN lex_shop_settings.guardrails_warn_count IS 'Running count of guardrail warnings since last reset';
COMMENT ON COLUMN lex_shop_settings.guardrails_block_count IS 'Running count of guardrail blocks since last reset';
COMMENT ON COLUMN lex_shop_settings.guardrails_false_positive_count IS 'Count of false positives reported by reviewers';

-- 2. lex_guardrails_events table — stores guardrail scan results without original text (SHA256 hash only)
CREATE TABLE IF NOT EXISTS lex_guardrails_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  pipeline_phase VARCHAR(40) NOT NULL,
  scan_point VARCHAR(40) NOT NULL,
  verdict VARCHAR(20) NOT NULL DEFAULT 'pass',
  reasons TEXT[] NOT NULL DEFAULT '{}',
  input_hash VARCHAR(64) NOT NULL,
  output_hash VARCHAR(64),
  entity_id UUID,
  entity_type VARCHAR(40),
  term_id UUID REFERENCES lex_terms(id) ON DELETE SET NULL,
  run_id UUID REFERENCES lex_runs(id) ON DELETE SET NULL,
  shard_idx INTEGER,
  confidence_score DECIMAL(5, 4),
  metadata JSONB NOT NULL DEFAULT '{}',
  is_false_positive BOOLEAN NOT NULL DEFAULT false,
  reviewed_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lex_guardrails_events IS 'Audit trail for guardrail scan results. Original text is NOT stored — only SHA256 hashes for forensic matching.';
COMMENT ON COLUMN lex_guardrails_events.input_hash IS 'SHA256 hash of the scanned input text';
COMMENT ON COLUMN lex_guardrails_events.output_hash IS 'SHA256 hash of the scanned output text (NULL for input-only scans)';
COMMENT ON COLUMN lex_guardrails_events.verdict IS 'pass | warn | block';

-- 3. Indexes for query patterns
CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_shop_created
  ON lex_guardrails_events (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_shop_verdict
  ON lex_guardrails_events (shop_id, verdict)
  WHERE verdict != 'pass';

CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_shop_phase_scan
  ON lex_guardrails_events (shop_id, pipeline_phase, scan_point);

CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_term
  ON lex_guardrails_events (term_id)
  WHERE term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_run
  ON lex_guardrails_events (run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lex_guardrails_events_false_positive
  ON lex_guardrails_events (shop_id, is_false_positive)
  WHERE is_false_positive = true;
