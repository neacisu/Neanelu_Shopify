ALTER TABLE collection_pending_changes
  DROP CONSTRAINT IF EXISTS chk_collection_pending_changes_type;

ALTER TABLE collection_pending_changes
  ADD CONSTRAINT chk_collection_pending_changes_type
    CHECK (change_type IN ('field_update', 'taxonomy_assign', 'taxonomy_unassign', 'menu_assign', 'product_dissociate'));
