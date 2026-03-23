-- Enforce at most one non-merged lex_terms row per (shop_id, normalized_key, ngram_size).
-- Merged rows are excluded so a new active term can be created after merge (same key as merged source).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_terms_shop_norm_ngram_unique_non_merged
ON lex_terms (shop_id, normalized_key, ngram_size)
WHERE status <> 'merged';
