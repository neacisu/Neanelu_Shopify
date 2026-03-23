-- Migration: 0118_lex_shop_settings_ai_translation.sql
-- Purpose: Self-hosted / LLM translation configuration on lex_shop_settings (TASK F)

ALTER TABLE lex_shop_settings
  ADD COLUMN IF NOT EXISTS translation_mode VARCHAR(20) NOT NULL DEFAULT 'auto'
    CONSTRAINT chk_lex_shop_settings_translation_mode
      CHECK (translation_mode IN ('single', 'consensus', 'auto')),
  ADD COLUMN IF NOT EXISTS consensus_escalation_threshold NUMERIC(5, 4) NOT NULL DEFAULT 0.8000
    CONSTRAINT chk_lex_shop_settings_consensus_escalation_threshold
      CHECK (consensus_escalation_threshold >= 0 AND consensus_escalation_threshold <= 1),
  ADD COLUMN IF NOT EXISTS tm_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tm_similarity_threshold NUMERIC(5, 4) NOT NULL DEFAULT 0.9200
    CONSTRAINT chk_lex_shop_settings_tm_similarity_threshold
      CHECK (tm_similarity_threshold >= 0 AND tm_similarity_threshold <= 1),
  ADD COLUMN IF NOT EXISTS quality_audit_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quality_audit_min_batch_size INTEGER NOT NULL DEFAULT 50
    CONSTRAINT chk_lex_shop_settings_quality_audit_min_batch_size
      CHECK (quality_audit_min_batch_size >= 1),
  ADD COLUMN IF NOT EXISTS max_terms_per_llm_batch INTEGER NOT NULL DEFAULT 10
    CONSTRAINT chk_lex_shop_settings_max_terms_per_llm_batch
      CHECK (max_terms_per_llm_batch >= 1 AND max_terms_per_llm_batch <= 500);

COMMENT ON COLUMN lex_shop_settings.translation_mode IS 'single | consensus | auto — how to run LLM translation';
COMMENT ON COLUMN lex_shop_settings.consensus_escalation_threshold IS 'Below this confidence, escalate to multi-model consensus (0–1)';
COMMENT ON COLUMN lex_shop_settings.tm_enabled IS 'Enable semantic translation memory (embeddings) lookup';
COMMENT ON COLUMN lex_shop_settings.tm_similarity_threshold IS 'Minimum cosine similarity for TM hit (0–1)';
COMMENT ON COLUMN lex_shop_settings.quality_audit_enabled IS 'Enable periodic QwQ quality audit batches';
COMMENT ON COLUMN lex_shop_settings.quality_audit_min_batch_size IS 'Minimum new translations before running quality audit';
COMMENT ON COLUMN lex_shop_settings.max_terms_per_llm_batch IS 'Max terms per LLM batch call';
