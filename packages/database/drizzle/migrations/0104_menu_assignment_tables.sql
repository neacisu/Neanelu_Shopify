-- Migration: 0104_menu_assignment_tables.sql
-- Purpose: AI menu/category assignments for Shopify collections

CREATE TABLE IF NOT EXISTS shopify_collection_menu_assignments (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES shopify_collections(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES shopify_menu_items(id) ON DELETE CASCADE,
  menu_id UUID REFERENCES shopify_menus(id) ON DELETE SET NULL,
  assignment_source VARCHAR(32) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  confidence REAL,
  reasoning TEXT,
  translated_query TEXT,
  model_translation VARCHAR(255),
  model_embedding VARCHAR(255),
  model_selection VARCHAR(255),
  proposed_path TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'proposed',
  approved_at TIMESTAMPTZ,
  approved_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_collection_menu_assignment_source
    CHECK (assignment_source IN ('ai', 'manual', 'sync', 'reviewed_ai')),
  CONSTRAINT chk_collection_menu_assignment_status
    CHECK (status IN ('active', 'proposed', 'approved', 'rejected')),
  CONSTRAINT chk_collection_menu_assignment_confidence
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT chk_collection_menu_assignment_target
    CHECK (menu_item_id IS NOT NULL OR proposed_path IS NOT NULL),
  CONSTRAINT chk_collection_menu_assignment_approved
    CHECK ((approved_at IS NULL AND approved_by IS NULL) OR approved_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_menu_assignments_shop_item_unique
  ON shopify_collection_menu_assignments(shop_id, collection_id, menu_item_id)
  WHERE menu_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_menu_assignments_shop_proposed_unique
  ON shopify_collection_menu_assignments(shop_id, collection_id, proposed_path)
  WHERE proposed_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_menu_assignments_single_primary
  ON shopify_collection_menu_assignments(shop_id, collection_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignments_collection
  ON shopify_collection_menu_assignments(shop_id, collection_id);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignments_menu_item
  ON shopify_collection_menu_assignments(shop_id, menu_item_id);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignments_status
  ON shopify_collection_menu_assignments(shop_id, status);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignments_menu
  ON shopify_collection_menu_assignments(shop_id, menu_id);

ALTER TABLE shopify_collection_menu_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_collection_menu_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_collection_menu_assignments
  ON shopify_collection_menu_assignments
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

CREATE TRIGGER trg_collection_menu_assignments_updated_at
  BEFORE UPDATE ON shopify_collection_menu_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE shopify_collection_menu_assignments IS
  'AI and manual many-to-many placements of collections into the synced Shopify menu tree';

COMMENT ON COLUMN shopify_collection_menu_assignments.menu_item_id IS
  'Target menu item when the assignment points to an existing Shopify menu node';

COMMENT ON COLUMN shopify_collection_menu_assignments.proposed_path IS
  'Human-review path proposal when no existing menu item is a safe match';

COMMENT ON COLUMN shopify_collection_menu_assignments.assignment_source IS
  'Origin of the assignment: ai, manual, sync or reviewed_ai';

COMMENT ON COLUMN shopify_collection_menu_assignments.status IS
  'Lifecycle of the assignment: active, proposed, approved or rejected';

CREATE TABLE IF NOT EXISTS shopify_collection_menu_assignment_audits (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES shopify_collection_menu_assignments(id) ON DELETE SET NULL,
  collection_id UUID NOT NULL REFERENCES shopify_collections(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_set JSONB NOT NULL DEFAULT '[]'::jsonb,
  llm_output_raw TEXT,
  guardrails_verdict JSONB NOT NULL DEFAULT '{}'::jsonb,
  models_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_collection_menu_assignment_audit_action
    CHECK (action IN ('created', 'approved', 'rejected', 'set_primary', 'deleted', 'auto_activated', 'invalidated'))
);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignment_audits_assignment
  ON shopify_collection_menu_assignment_audits(shop_id, assignment_id);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignment_audits_collection
  ON shopify_collection_menu_assignment_audits(shop_id, collection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignment_audits_action
  ON shopify_collection_menu_assignment_audits(shop_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignment_audits_input_context
  ON shopify_collection_menu_assignment_audits USING GIN (input_context jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_collection_menu_assignment_audits_candidate_set
  ON shopify_collection_menu_assignment_audits USING GIN (candidate_set jsonb_path_ops);

ALTER TABLE shopify_collection_menu_assignment_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_collection_menu_assignment_audits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_collection_menu_assignment_audits
  ON shopify_collection_menu_assignment_audits
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

COMMENT ON TABLE shopify_collection_menu_assignment_audits IS
  'Immutable audit trail for AI menu assignment decisions, reviews and invalidations';
