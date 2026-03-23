-- Quality audit batches (QwQ-32B) — extend ai_batches.batch_type CHECK
ALTER TABLE ai_batches DROP CONSTRAINT IF EXISTS chk_ai_batch_type;
ALTER TABLE ai_batches
  ADD CONSTRAINT chk_ai_batch_type
  CHECK (batch_type IN ('embedding', 'extraction', 'enrichment', 'translation', 'translation_audit'));
