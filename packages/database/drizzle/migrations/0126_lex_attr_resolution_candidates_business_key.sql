-- Idempotent upserts for lex_attribute_resolution_candidates (retry-safe BullMQ).
-- COALESCE maps NULL cluster_id / definition_id to a sentinel UUID so ON CONFLICT matches one row per logical key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_attr_resolution_candidates_business_key
  ON lex_attribute_resolution_candidates(
    shop_id,
    term_id,
    COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(definition_id, '00000000-0000-0000-0000-000000000000'::uuid),
    resolution_role
  );
