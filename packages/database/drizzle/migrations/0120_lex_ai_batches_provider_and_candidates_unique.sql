-- Allow self-hosted / frontier providers on ai_batches (lex translation + embeddings).
ALTER TABLE ai_batches DROP CONSTRAINT IF EXISTS chk_ai_batch_provider;
ALTER TABLE ai_batches
  ADD CONSTRAINT chk_ai_batch_provider
  CHECK (provider IN ('openai', 'anthropic', 'google', 'selfhosted', 'xai', 'deepseek'));

-- Idempotent upsert for translation candidates on BullMQ retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_translation_candidates_shop_term_cluster_lang_rank
  ON lex_translation_candidates(shop_id, term_id, cluster_id, source_lang, target_lang, rank);
