-- One open (pending/in_review) review item per (shop, entity_type, entity_id, review_reason).
-- Enables INSERT ... ON CONFLICT ... DO NOTHING for race-free enqueue.

DELETE FROM lex_review_items a
    USING lex_review_items b
  WHERE a.id > b.id
    AND a.shop_id = b.shop_id
    AND a.entity_type = b.entity_type
    AND a.entity_id = b.entity_id
    AND a.review_reason = b.review_reason
    AND a.status IN ('pending', 'in_review')
    AND b.status IN ('pending', 'in_review');

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_review_items_shop_entity_reason_open_unique
  ON lex_review_items (shop_id, entity_type, entity_id, review_reason)
  WHERE (status IN ('pending', 'in_review'));
