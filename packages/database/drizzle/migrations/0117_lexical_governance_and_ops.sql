-- Migration: 0117_lexical_governance_and_ops.sql
-- Purpose: Complete Module N governance, review execution contracts, and retention/runtime support

-- ============================================
-- Canonical-table versioning and global support
-- ============================================

ALTER TABLE lex_translation_rules
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_domain_profiles
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_stopwords
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE lex_attribute_resolutions
  ALTER COLUMN shop_id DROP NOT NULL;

DROP INDEX IF EXISTS idx_lex_attribute_resolutions_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_attribute_resolutions_shop_unique
  ON lex_attribute_resolutions(shop_id, term_id, cluster_id, definition_id, resolution_role)
  WHERE shop_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_attribute_resolutions_global_unique
  ON lex_attribute_resolutions(term_id, cluster_id, definition_id, resolution_role)
  WHERE shop_id IS NULL;

-- ============================================
-- Global governance workflow
-- ============================================

CREATE TABLE IF NOT EXISTS lex_governance_requests (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  request_scope VARCHAR(20) NOT NULL DEFAULT 'global',
  target_id UUID,
  title VARCHAR(255),
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  proposed_payload JSONB NOT NULL DEFAULT '{}',
  proposed_hash VARCHAR(64) NOT NULL,
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  rejected_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  applied_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  notes TEXT,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_lex_governance_requests_entity_type
    CHECK (entity_type IN ('glossary_entry', 'translation_rule', 'domain_profile', 'stopword', 'locked_translation', 'attribute_resolution')),
  CONSTRAINT chk_lex_governance_requests_scope
    CHECK (request_scope IN ('global')),
  CONSTRAINT chk_lex_governance_requests_status
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'applied', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_lex_governance_requests_shop_status
  ON lex_governance_requests(shop_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lex_governance_requests_entity
  ON lex_governance_requests(entity_type, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_governance_requests_non_terminal_dedupe
  ON lex_governance_requests(
    shop_id,
    entity_type,
    COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    proposed_hash
  )
  WHERE status IN ('draft', 'pending_approval', 'approved');

CREATE TABLE IF NOT EXISTS lex_governance_request_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  request_id UUID NOT NULL REFERENCES lex_governance_requests(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  action VARCHAR(20) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_lex_governance_request_events_action
    CHECK (action IN ('create', 'update', 'submit', 'approve', 'reject', 'apply', 'cancel'))
);

CREATE INDEX IF NOT EXISTS idx_lex_governance_request_events_request
  ON lex_governance_request_events(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lex_governance_request_events_shop_action
  ON lex_governance_request_events(shop_id, action, created_at DESC);

-- ============================================
-- Review action expansion
-- ============================================

ALTER TABLE lex_review_items
  ADD COLUMN IF NOT EXISTS assignment_notes TEXT;

ALTER TABLE lex_decisions DROP CONSTRAINT IF EXISTS chk_lex_decisions_type;
ALTER TABLE lex_decisions
  ADD CONSTRAINT chk_lex_decisions_type
  CHECK (decision_type IN ('approve', 'reject', 'merge_terms', 'split_cluster', 'lock_translation', 'publish', 'assign'));

-- ============================================
-- Publication and rollback support
-- ============================================

ALTER TABLE lex_publication_targets
  ADD COLUMN IF NOT EXISTS last_event_id UUID;

-- ============================================
-- Stopwords updated_at trigger
-- ============================================

DROP TRIGGER IF EXISTS trg_lex_stopwords_updated_at ON lex_stopwords;
CREATE TRIGGER trg_lex_stopwords_updated_at
  BEFORE UPDATE ON lex_stopwords
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Governance tables are operational and RLS-protected
-- ============================================

ALTER TABLE lex_governance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_governance_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lex_governance_requests ON lex_governance_requests;
CREATE POLICY tenant_isolation_lex_governance_requests ON lex_governance_requests
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);

ALTER TABLE lex_governance_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_governance_request_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lex_governance_request_events ON lex_governance_request_events;
CREATE POLICY tenant_isolation_lex_governance_request_events ON lex_governance_request_events
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
  WITH CHECK (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
