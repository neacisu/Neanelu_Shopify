-- Migration: 0108_collection_pending_changes.sql
-- Purpose: HITL approval queue for collection sync-back operations to Shopify

CREATE TABLE IF NOT EXISTS collection_pending_changes (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES shopify_collections(id) ON DELETE CASCADE,
  change_type VARCHAR(30) NOT NULL,
  field_name VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  shopify_mutation VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  CONSTRAINT chk_collection_pending_changes_type
    CHECK (change_type IN ('field_update', 'taxonomy_assign', 'taxonomy_unassign', 'menu_assign')),
  CONSTRAINT chk_collection_pending_changes_source
    CHECK (source IN ('manual', 'ai_generate', 'ai_translate', 'ai_taxonomy', 'ai_menu', 'sync')),
  CONSTRAINT chk_collection_pending_changes_status
    CHECK (status IN ('pending', 'approved', 'synced', 'failed', 'rejected')),
  CONSTRAINT chk_collection_pending_changes_field_update
    CHECK (
      change_type != 'field_update'
      OR (field_name IS NOT NULL AND new_value IS NOT NULL)
    ),
  CONSTRAINT chk_collection_pending_changes_taxonomy_assign
    CHECK (change_type != 'taxonomy_assign' OR metadata <> '{}'::jsonb),
  CONSTRAINT chk_collection_pending_changes_taxonomy_unassign
    CHECK (change_type != 'taxonomy_unassign' OR metadata <> '{}'::jsonb),
  CONSTRAINT chk_collection_pending_changes_menu
    CHECK (change_type != 'menu_assign' OR metadata <> '{}'::jsonb)
);

CREATE INDEX IF NOT EXISTS idx_pending_changes_shop_status
  ON collection_pending_changes(shop_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_changes_collection
  ON collection_pending_changes(collection_id);

CREATE INDEX IF NOT EXISTS idx_pending_changes_type
  ON collection_pending_changes(shop_id, change_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_field_update
  ON collection_pending_changes(collection_id, field_name)
  WHERE status = 'pending' AND change_type = 'field_update';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_taxonomy_assign
  ON collection_pending_changes(collection_id)
  WHERE status = 'pending' AND change_type = 'taxonomy_assign';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_taxonomy_unassign
  ON collection_pending_changes(collection_id)
  WHERE status = 'pending' AND change_type = 'taxonomy_unassign';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_menu
  ON collection_pending_changes(collection_id, (metadata->>'assignmentId'))
  WHERE status = 'pending' AND change_type = 'menu_assign';

ALTER TABLE collection_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_pending_changes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_collection_pending_changes
  ON collection_pending_changes
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

COMMENT ON TABLE collection_pending_changes IS
  'HITL approval queue for collection sync-back operations to Shopify (field updates, taxonomy changes and menu changes)';
