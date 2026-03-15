-- Migration: 0116_lexical_module_hardening.sql
-- Purpose: Harden Module N runtime, governance, rollout, and publication contracts

-- ============================================
-- Lifecycle and optimistic concurrency columns
-- ============================================

ALTER TABLE lex_shop_settings
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_runs
  ADD COLUMN IF NOT EXISTS current_phase VARCHAR(50) NOT NULL DEFAULT 'extract.fragments',
  ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phase_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS completed_with_errors BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE lex_run_shards
  ADD COLUMN IF NOT EXISTS phase_name VARCHAR(50) NOT NULL DEFAULT 'extract.fragments',
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS checkpoint_cursor JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS completed_with_errors BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE lex_checkpoints
  ADD COLUMN IF NOT EXISTS shard_id UUID REFERENCES lex_run_shards(id) ON DELETE SET NULL;

ALTER TABLE lex_terms
  ADD COLUMN IF NOT EXISTS merged_into_term_id UUID REFERENCES lex_terms(id) ON DELETE SET NULL;

ALTER TABLE lex_sense_clusters
  ADD COLUMN IF NOT EXISTS origin_cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL;

ALTER TABLE lex_glossary_entries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_translations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE lex_attribute_resolutions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_review_items
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_entity_localizations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE lex_publication_targets
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS target_snapshot_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS published_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS previous_snapshot JSONB;

-- ============================================
-- New lexical runtime support tables
-- ============================================

CREATE TABLE IF NOT EXISTS lex_source_watermarks (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_table VARCHAR(50) NOT NULL,
  phase_name VARCHAR(50) NOT NULL,
  last_success_updated_at TIMESTAMPTZ,
  last_success_id UUID,
  snapshot_hash VARCHAR(64),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_source_watermarks_unique
  ON lex_source_watermarks(shop_id, source_table, phase_name);

CREATE INDEX IF NOT EXISTS idx_lex_source_watermarks_shop_phase
  ON lex_source_watermarks(shop_id, phase_name);

CREATE TABLE IF NOT EXISTS lex_run_phase_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  run_id UUID NOT NULL REFERENCES lex_runs(id) ON DELETE CASCADE,
  shard_id UUID REFERENCES lex_run_shards(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  phase_name VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_run_phase_events_run_phase
  ON lex_run_phase_events(run_id, phase_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lex_run_phase_events_shop_event
  ON lex_run_phase_events(shop_id, event_type, created_at DESC);

-- ============================================
-- Constraint hardening
-- ============================================

ALTER TABLE lex_runs DROP CONSTRAINT IF EXISTS chk_lex_runs_status;
ALTER TABLE lex_runs
  ADD CONSTRAINT chk_lex_runs_status
  CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled'));

ALTER TABLE lex_run_shards DROP CONSTRAINT IF EXISTS chk_lex_run_shards_status;
ALTER TABLE lex_run_shards
  ADD CONSTRAINT chk_lex_run_shards_status
  CHECK (status IN ('pending', 'running', 'retrying', 'blocked', 'completed', 'failed', 'cancelled'));

ALTER TABLE lex_review_items DROP CONSTRAINT IF EXISTS chk_lex_review_items_severity;
ALTER TABLE lex_review_items
  ADD CONSTRAINT chk_lex_review_items_severity
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE lex_review_items DROP CONSTRAINT IF EXISTS chk_lex_review_items_status;
ALTER TABLE lex_review_items
  ADD CONSTRAINT chk_lex_review_items_status
  CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'superseded'));

ALTER TABLE lex_decisions DROP CONSTRAINT IF EXISTS chk_lex_decisions_type;
ALTER TABLE lex_decisions
  ADD CONSTRAINT chk_lex_decisions_type
  CHECK (decision_type IN ('approve', 'reject', 'merge_terms', 'split_cluster', 'lock_translation', 'publish'));

ALTER TABLE lex_entity_localizations DROP CONSTRAINT IF EXISTS chk_lex_entity_localizations_status;
ALTER TABLE lex_entity_localizations
  ADD CONSTRAINT chk_lex_entity_localizations_status
  CHECK (publication_status IN ('draft', 'approved', 'publishing', 'published', 'publish_failed', 'superseded'));

ALTER TABLE lex_publication_targets DROP CONSTRAINT IF EXISTS chk_lex_publication_targets_status;
ALTER TABLE lex_publication_targets
  ADD CONSTRAINT chk_lex_publication_targets_status
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped', 'rolled_back', 'cancelled'));

ALTER TABLE lex_publish_events DROP CONSTRAINT IF EXISTS chk_lex_publish_events_action;
ALTER TABLE lex_publish_events
  ADD CONSTRAINT chk_lex_publish_events_action
  CHECK (action IN ('insert', 'update', 'noop', 'retry', 'rollback', 'skip'));

ALTER TABLE lex_publish_events DROP CONSTRAINT IF EXISTS chk_lex_publish_events_status;
ALTER TABLE lex_publish_events
  ADD CONSTRAINT chk_lex_publish_events_status
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped', 'rolled_back', 'cancelled'));

-- ============================================
-- Idempotency and business-key uniqueness
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_runs_single_active_per_shop
  ON lex_runs(shop_id)
  WHERE status IN ('pending', 'running', 'paused');

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_run_shards_phase_source_key
  ON lex_run_shards(run_id, phase_name, source_table, shard_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_publication_targets_business_key
  ON lex_publication_targets(
    COALESCE(localization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    target_type,
    COALESCE(target_record_id::text, target_path, ''),
    COALESCE(target_snapshot_hash, '')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_glossary_entries_shop_active_unique
  ON lex_glossary_entries(
    shop_id,
    normalized_source_text,
    source_lang,
    target_lang,
    COALESCE(domain_code, ''),
    COALESCE(sense_hint, '')
  )
  WHERE shop_id IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_glossary_entries_global_active_unique
  ON lex_glossary_entries(
    normalized_source_text,
    source_lang,
    target_lang,
    COALESCE(domain_code, ''),
    COALESCE(sense_hint, '')
  )
  WHERE shop_id IS NULL AND is_active = true;

-- ============================================
-- Query performance on hot fact tables
-- ============================================

CREATE INDEX IF NOT EXISTS idx_lex_fragments_shop_created_at
  ON lex_fragments(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lex_fragments_created_at_brin
  ON lex_fragments USING brin(created_at);

CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_shop_created_at
  ON lex_term_occurrences(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_created_at_brin
  ON lex_term_occurrences USING brin(created_at);

CREATE INDEX IF NOT EXISTS idx_lex_term_contexts_shop_created_at
  ON lex_term_contexts(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lex_term_contexts_created_at_brin
  ON lex_term_contexts USING brin(created_at);

CREATE INDEX IF NOT EXISTS idx_lex_publish_events_created_at_brin
  ON lex_publish_events USING brin(created_at);

-- ============================================
-- Effective resolution views (global + shop override)
-- ============================================

CREATE OR REPLACE VIEW lex_effective_terms AS
SELECT ranked.*
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (
      PARTITION BY t.normalized_key, t.ngram_size, COALESCE(t.domain_code, ''), t.term_type
      ORDER BY
        CASE
          WHEN t.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid THEN 0
          WHEN t.shop_id IS NULL THEN 1
          ELSE 2
        END,
        t.updated_at DESC,
        t.created_at DESC,
        t.id DESC
    ) AS rn
  FROM lex_terms t
  WHERE t.shop_id IS NULL
     OR t.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid
) ranked
WHERE ranked.rn = 1;

CREATE OR REPLACE VIEW lex_effective_glossary_entries AS
SELECT ranked.*
FROM (
  SELECT
    g.*,
    ROW_NUMBER() OVER (
      PARTITION BY g.normalized_source_text, g.source_lang, g.target_lang, COALESCE(g.domain_code, ''), COALESCE(g.sense_hint, '')
      ORDER BY
        CASE
          WHEN g.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid THEN 0
          WHEN g.shop_id IS NULL THEN 1
          ELSE 2
        END,
        g.priority ASC,
        g.updated_at DESC,
        g.created_at DESC,
        g.id DESC
    ) AS rn
  FROM lex_glossary_entries g
  WHERE g.is_active = true
    AND (g.shop_id IS NULL OR g.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
) ranked
WHERE ranked.rn = 1;

CREATE OR REPLACE VIEW lex_effective_translation_rules AS
SELECT ranked.*
FROM (
  SELECT
    r.*,
    ROW_NUMBER() OVER (
      PARTITION BY r.match_term, r.source_lang, r.target_lang, COALESCE(r.domain_code, ''), r.target_translation
      ORDER BY
        CASE
          WHEN r.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid THEN 0
          WHEN r.shop_id IS NULL THEN 1
          ELSE 2
        END,
        r.priority ASC,
        r.updated_at DESC,
        r.created_at DESC,
        r.id DESC
    ) AS rn
  FROM lex_translation_rules r
  WHERE r.is_active = true
    AND (r.shop_id IS NULL OR r.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid)
) ranked
WHERE ranked.rn = 1;

CREATE OR REPLACE VIEW lex_effective_translations AS
SELECT ranked.*
FROM (
  SELECT
    t.*,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(t.term_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   COALESCE(t.cluster_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   t.source_lang,
                   t.target_lang
      ORDER BY
        CASE
          WHEN t.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid THEN 0
          WHEN t.shop_id IS NULL THEN 1
          ELSE 2
        END,
        CASE WHEN t.is_locked THEN 0 ELSE 1 END,
        t.updated_at DESC,
        t.created_at DESC,
        t.id DESC
    ) AS rn
  FROM lex_translations t
  WHERE t.shop_id IS NULL
     OR t.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid
) ranked
WHERE ranked.rn = 1;

CREATE OR REPLACE VIEW lex_effective_attribute_resolutions AS
SELECT ranked.*
FROM (
  SELECT
    r.*,
    ROW_NUMBER() OVER (
      PARTITION BY r.term_id,
                   COALESCE(r.cluster_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   r.definition_id,
                   r.resolution_role
      ORDER BY
        CASE
          WHEN r.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid THEN 0
          WHEN r.shop_id IS NULL THEN 1
          ELSE 2
        END,
        r.updated_at DESC,
        r.created_at DESC,
        r.id DESC
    ) AS rn
  FROM lex_attribute_resolutions r
  WHERE r.shop_id IS NULL
     OR r.shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid
) ranked
WHERE ranked.rn = 1;

-- ============================================
-- RLS hardening on canonical tables
-- ============================================

DO $$
DECLARE
  tbl TEXT;
  canonical_tables TEXT[] := ARRAY[
    'lex_terms',
    'lex_term_variants',
    'lex_sense_clusters',
    'lex_domain_profiles',
    'lex_glossary_entries',
    'lex_translation_rules',
    'lex_translation_candidates',
    'lex_translations',
    'lex_attribute_resolution_candidates',
    'lex_attribute_resolutions',
    'lex_stopwords',
    'lex_source_watermarks',
    'lex_run_phase_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY canonical_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting(''app.current_shop_id'', true), '''')::uuid, ''00000000-0000-0000-0000-000000000000''::uuid)) WITH CHECK (shop_id IS NULL OR shop_id = COALESCE(NULLIF(current_setting(''app.current_shop_id'', true), '''')::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))',
      'tenant_isolation_' || tbl,
      tbl
    );
  END LOOP;
END $$;
