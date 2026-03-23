-- Fix NULL != NULL bypass in lex_translation_candidates unique constraint.
-- cluster_id is nullable; PostgreSQL treats each NULL as distinct in unique indexes,
-- so COALESCE to a sentinel UUID to enforce proper dedup.

DROP INDEX IF EXISTS idx_lex_translation_candidates_shop_term_cluster_lang_rank;

CREATE UNIQUE INDEX idx_lex_translation_candidates_shop_term_cluster_lang_rank
  ON lex_translation_candidates(
    shop_id,
    term_id,
    COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_lang,
    target_lang,
    rank
  );
