-- Migration: 0115_lexical_module_foundation.sql
-- Purpose: Module N - Lexical Intelligence & Contextual Translation foundation
--
-- Notes:
-- - This migration is additive and does not change the functional model of existing PIM tables.
-- - Foundation tables are created as regular tables in v1. Monthly partitioning for the largest
--   lexical fact tables is intentionally deferred because the existing UUID-only FK graph would
--   require a composite partition-key redesign.

-- ============================================
-- Operational config
-- ============================================

CREATE TABLE IF NOT EXISTS lex_shop_settings (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ro',
  target_langs TEXT[] NOT NULL DEFAULT '{en}'::text[],
  extract_scope JSONB NOT NULL DEFAULT '{}',
  shard_size INTEGER NOT NULL DEFAULT 10000,
  thresholds JSONB NOT NULL DEFAULT '{}',
  retention_days_fragments INTEGER NOT NULL DEFAULT 90,
  retention_days_occurrences INTEGER NOT NULL DEFAULT 90,
  retention_days_contexts INTEGER NOT NULL DEFAULT 180,
  auto_publish_products BOOLEAN NOT NULL DEFAULT false,
  auto_publish_attributes BOOLEAN NOT NULL DEFAULT false,
  auto_publish_collections BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_shop_settings_enabled ON lex_shop_settings(enabled);

-- ============================================
-- Runs and orchestration
-- ============================================

CREATE TABLE IF NOT EXISTS lex_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  run_type VARCHAR(30) NOT NULL,
  source_scope JSONB NOT NULL DEFAULT '{}',
  source_snapshot_hash VARCHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  fragments_count BIGINT DEFAULT 0,
  occurrences_count BIGINT DEFAULT 0,
  terms_count BIGINT DEFAULT 0,
  contexts_count BIGINT DEFAULT 0,
  sense_clusters_count BIGINT DEFAULT 0,
  translations_count BIGINT DEFAULT 0,
  ai_batches_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_lex_runs_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_lex_runs_shop_status ON lex_runs(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_lex_runs_shop_type_created ON lex_runs(shop_id, run_type, created_at DESC);

CREATE TABLE IF NOT EXISTS lex_run_shards (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  run_id UUID NOT NULL REFERENCES lex_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shard_key VARCHAR(100) NOT NULL,
  source_table VARCHAR(50) NOT NULL,
  min_source_id UUID,
  max_source_id UUID,
  status VARCHAR(20) DEFAULT 'pending',
  worker_name VARCHAR(100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_read BIGINT DEFAULT 0,
  records_written BIGINT DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_lex_run_shards_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_lex_run_shards_run_status ON lex_run_shards(run_id, status);
CREATE INDEX IF NOT EXISTS idx_lex_run_shards_shop_source_status ON lex_run_shards(shop_id, source_table, status);

CREATE TABLE IF NOT EXISTS lex_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  run_id UUID NOT NULL REFERENCES lex_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  worker_name VARCHAR(100) NOT NULL,
  checkpoint_type VARCHAR(50) NOT NULL,
  checkpoint_value JSONB NOT NULL,
  heartbeat_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_checkpoints_run_worker_type
  ON lex_checkpoints(run_id, worker_name, checkpoint_type);
CREATE INDEX IF NOT EXISTS idx_lex_checkpoints_shop_worker_updated
  ON lex_checkpoints(shop_id, worker_name, updated_at DESC);

-- ============================================
-- Source fragments
-- ============================================

CREATE TABLE IF NOT EXISTS lex_fragments (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  run_id UUID NOT NULL REFERENCES lex_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_table VARCHAR(50) NOT NULL,
  source_record_id UUID NOT NULL,
  source_gid VARCHAR(100),
  product_id UUID REFERENCES shopify_products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES shopify_variants(id) ON DELETE SET NULL,
  collection_id UUID REFERENCES shopify_collections(id) ON DELETE SET NULL,
  master_product_id UUID REFERENCES prod_master(id) ON DELETE SET NULL,
  field_path TEXT NOT NULL,
  field_kind VARCHAR(40) NOT NULL,
  raw_text TEXT NOT NULL,
  clean_text TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  language_guess VARCHAR(10) DEFAULT 'ro',
  html_stripped BOOLEAN DEFAULT false,
  token_count INTEGER DEFAULT 0,
  char_count INTEGER DEFAULT 0,
  vendor_hint VARCHAR(255),
  product_type_hint VARCHAR(255),
  category_hint VARCHAR(255),
  taxonomy_id UUID REFERENCES prod_taxonomy(id) ON DELETE SET NULL,
  content_hash VARCHAR(64) NOT NULL,
  is_noise BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_fragments_shop_run ON lex_fragments(shop_id, run_id);
CREATE INDEX IF NOT EXISTS idx_lex_fragments_shop_source_record ON lex_fragments(shop_id, source_table, source_record_id);
CREATE INDEX IF NOT EXISTS idx_lex_fragments_shop_field_kind ON lex_fragments(shop_id, field_kind);
CREATE INDEX IF NOT EXISTS idx_lex_fragments_shop_content_hash ON lex_fragments(shop_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_lex_fragments_canonical_text_trgm
  ON lex_fragments USING GIN (canonical_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS lex_fragment_entities (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  fragment_id UUID NOT NULL REFERENCES lex_fragments(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  entity_text TEXT NOT NULL,
  canonical_entity_text TEXT NOT NULL,
  normalized_value VARCHAR(255),
  unit VARCHAR(50),
  span_start INTEGER,
  span_end INTEGER,
  confidence_score DECIMAL(5,4),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_fragment_entities_fragment ON lex_fragment_entities(fragment_id);
CREATE INDEX IF NOT EXISTS idx_lex_fragment_entities_shop_type ON lex_fragment_entities(shop_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_lex_fragment_entities_shop_canonical ON lex_fragment_entities(shop_id, canonical_entity_text);

CREATE TABLE IF NOT EXISTS lex_fragment_annotations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  fragment_id UUID NOT NULL REFERENCES lex_fragments(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  annotation_type VARCHAR(50) NOT NULL,
  annotation_value JSONB NOT NULL,
  source VARCHAR(30) DEFAULT 'system',
  confidence_score DECIMAL(5,4),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_fragment_annotations_fragment ON lex_fragment_annotations(fragment_id);
CREATE INDEX IF NOT EXISTS idx_lex_fragment_annotations_shop_type ON lex_fragment_annotations(shop_id, annotation_type);

-- ============================================
-- Canonical term inventory
-- ============================================

CREATE TABLE IF NOT EXISTS lex_terms (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  canonical_text TEXT NOT NULL,
  normalized_key VARCHAR(255) NOT NULL,
  display_text_ro TEXT,
  ngram_size SMALLINT NOT NULL,
  term_type VARCHAR(30) NOT NULL,
  domain_code VARCHAR(100),
  is_technical BOOLEAN DEFAULT false,
  is_protected BOOLEAN DEFAULT false,
  is_stopword BOOLEAN DEFAULT false,
  is_attribute_candidate BOOLEAN DEFAULT false,
  is_value_candidate BOOLEAN DEFAULT false,
  is_brand_candidate BOOLEAN DEFAULT false,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_terms_shop_normalized ON lex_terms(shop_id, normalized_key, ngram_size);
CREATE INDEX IF NOT EXISTS idx_lex_terms_shop_domain_status ON lex_terms(shop_id, domain_code, status);
CREATE INDEX IF NOT EXISTS idx_lex_terms_technical_partial ON lex_terms(shop_id, normalized_key) WHERE is_technical = true;

CREATE TABLE IF NOT EXISTS lex_term_variants (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  variant_text TEXT NOT NULL,
  normalized_variant VARCHAR(255) NOT NULL,
  locale VARCHAR(10) DEFAULT 'ro',
  script VARCHAR(20) DEFAULT 'latin',
  variant_type VARCHAR(30) NOT NULL,
  source VARCHAR(30) DEFAULT 'extracted',
  occurrence_count BIGINT DEFAULT 0,
  is_preferred BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_term_variants_term ON lex_term_variants(term_id);
CREATE INDEX IF NOT EXISTS idx_lex_term_variants_shop_normalized ON lex_term_variants(shop_id, normalized_variant);
CREATE INDEX IF NOT EXISTS idx_lex_term_variants_text_trgm
  ON lex_term_variants USING GIN (variant_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS lex_term_occurrences (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  run_id UUID NOT NULL REFERENCES lex_runs(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  fragment_id UUID NOT NULL REFERENCES lex_fragments(id) ON DELETE CASCADE,
  position_start INTEGER NOT NULL,
  position_end INTEGER NOT NULL,
  sentence_index INTEGER,
  token_index INTEGER,
  left_context TEXT,
  right_context TEXT,
  neighbor_terms TEXT[] NOT NULL DEFAULT '{}'::text[],
  context_hash VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_shop_term ON lex_term_occurrences(shop_id, term_id);
CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_fragment ON lex_term_occurrences(fragment_id);
CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_shop_context_hash ON lex_term_occurrences(shop_id, context_hash);
CREATE INDEX IF NOT EXISTS idx_lex_term_occurrences_run_term ON lex_term_occurrences(run_id, term_id);

CREATE TABLE IF NOT EXISTS lex_term_stats (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  last_run_id UUID REFERENCES lex_runs(id) ON DELETE SET NULL,
  occurrences_total BIGINT DEFAULT 0,
  distinct_fragments BIGINT DEFAULT 0,
  distinct_products BIGINT DEFAULT 0,
  distinct_variants BIGINT DEFAULT 0,
  distinct_collections BIGINT DEFAULT 0,
  title_occurrences BIGINT DEFAULT 0,
  description_occurrences BIGINT DEFAULT 0,
  metafield_occurrences BIGINT DEFAULT 0,
  vendor_occurrences BIGINT DEFAULT 0,
  score_global DECIMAL(10,4),
  score_tfidf DECIMAL(10,4),
  score_domain DECIMAL(10,4),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_term_stats_shop_term ON lex_term_stats(shop_id, term_id);
CREATE INDEX IF NOT EXISTS idx_lex_term_stats_shop_score_global ON lex_term_stats(shop_id, score_global DESC);
CREATE INDEX IF NOT EXISTS idx_lex_term_stats_shop_score_domain ON lex_term_stats(shop_id, score_domain DESC);

-- ============================================
-- Context and sense mining
-- ============================================

CREATE TABLE IF NOT EXISTS lex_term_contexts (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  representative_text TEXT NOT NULL,
  context_hash VARCHAR(64) NOT NULL,
  field_kind VARCHAR(40),
  vendor_hint VARCHAR(255),
  product_type_hint VARCHAR(255),
  domain_code VARCHAR(100),
  taxonomy_id UUID REFERENCES prod_taxonomy(id) ON DELETE SET NULL,
  collection_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  occurrences_count BIGINT DEFAULT 1,
  sample_product_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  language_guess VARCHAR(10) DEFAULT 'ro',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_term_contexts_shop_term_hash
  ON lex_term_contexts(shop_id, term_id, context_hash);
CREATE INDEX IF NOT EXISTS idx_lex_term_contexts_shop_domain ON lex_term_contexts(shop_id, domain_code);
CREATE INDEX IF NOT EXISTS idx_lex_term_contexts_shop_taxonomy ON lex_term_contexts(shop_id, taxonomy_id);

CREATE TABLE IF NOT EXISTS lex_context_embeddings (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  context_id UUID NOT NULL REFERENCES lex_term_contexts(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  dimensions INTEGER NOT NULL DEFAULT 2000,
  content_hash VARCHAR(64) NOT NULL,
  embedding vector(2000) NOT NULL,
  status VARCHAR(20) DEFAULT 'ready',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_context_embeddings_context_model_hash
  ON lex_context_embeddings(context_id, model_name, content_hash);
CREATE INDEX IF NOT EXISTS idx_lex_context_embeddings_shop_status ON lex_context_embeddings(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_lex_context_embeddings_hnsw
  ON lex_context_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS lex_sense_clusters (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  cluster_key VARCHAR(100) NOT NULL,
  cluster_method VARCHAR(30) NOT NULL,
  domain_code VARCHAR(100),
  taxonomy_id UUID REFERENCES prod_taxonomy(id) ON DELETE SET NULL,
  label_ro TEXT,
  label_en TEXT,
  description TEXT,
  representative_context_id UUID REFERENCES lex_term_contexts(id) ON DELETE SET NULL,
  confidence_score DECIMAL(5,4),
  needs_review BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_sense_clusters_shop_term_key
  ON lex_sense_clusters(shop_id, term_id, cluster_key);
CREATE INDEX IF NOT EXISTS idx_lex_sense_clusters_shop_term_approved
  ON lex_sense_clusters(shop_id, term_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_lex_sense_clusters_shop_domain ON lex_sense_clusters(shop_id, domain_code);

CREATE TABLE IF NOT EXISTS lex_sense_cluster_members (
  cluster_id UUID NOT NULL REFERENCES lex_sense_clusters(id) ON DELETE CASCADE,
  context_id UUID NOT NULL REFERENCES lex_term_contexts(id) ON DELETE CASCADE,
  similarity_score DECIMAL(5,4),
  is_representative BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (cluster_id, context_id)
);

CREATE INDEX IF NOT EXISTS idx_lex_sense_cluster_members_context ON lex_sense_cluster_members(context_id);
CREATE INDEX IF NOT EXISTS idx_lex_sense_cluster_members_cluster_similarity
  ON lex_sense_cluster_members(cluster_id, similarity_score DESC);

CREATE TABLE IF NOT EXISTS lex_domain_profiles (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  domain_code VARCHAR(100) NOT NULL,
  name_ro VARCHAR(255) NOT NULL,
  name_en VARCHAR(255),
  description TEXT,
  category_hints JSONB DEFAULT '{}',
  protected_patterns JSONB DEFAULT '[]',
  required_neighbor_terms JSONB DEFAULT '[]',
  forbidden_neighbor_terms JSONB DEFAULT '[]',
  allowed_translation_styles JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_domain_profiles_shop_domain
  ON lex_domain_profiles(shop_id, domain_code);

-- ============================================
-- Translation intelligence
-- ============================================

CREATE TABLE IF NOT EXISTS lex_glossary_entries (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  domain_code VARCHAR(100),
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  source_text TEXT NOT NULL,
  normalized_source_text VARCHAR(255) NOT NULL,
  sense_hint VARCHAR(255),
  target_text TEXT NOT NULL,
  translation_kind VARCHAR(30) NOT NULL,
  priority INTEGER DEFAULT 100,
  is_locked BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  source VARCHAR(30) DEFAULT 'manual',
  confidence_score DECIMAL(5,4) DEFAULT 1.0,
  notes TEXT,
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_glossary_entries_shop_normalized
  ON lex_glossary_entries(shop_id, normalized_source_text, source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_lex_glossary_entries_shop_domain_active
  ON lex_glossary_entries(shop_id, domain_code, is_active);
CREATE INDEX IF NOT EXISTS idx_lex_glossary_entries_global_lookup
  ON lex_glossary_entries(normalized_source_text, target_lang)
  WHERE shop_id IS NULL;

CREATE TABLE IF NOT EXISTS lex_translation_rules (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  rule_name VARCHAR(255) NOT NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  match_term TEXT NOT NULL,
  domain_code VARCHAR(100),
  required_neighbors JSONB DEFAULT '[]',
  forbidden_neighbors JSONB DEFAULT '[]',
  required_field_kinds JSONB DEFAULT '[]',
  target_translation TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_translation_rules_shop_active
  ON lex_translation_rules(shop_id, is_active, priority);
CREATE INDEX IF NOT EXISTS idx_lex_translation_rules_shop_domain
  ON lex_translation_rules(shop_id, domain_code);

CREATE TABLE IF NOT EXISTS lex_translation_candidates (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  candidate_text TEXT NOT NULL,
  alternative_texts TEXT[] NOT NULL DEFAULT '{}'::text[],
  candidate_source VARCHAR(30) NOT NULL,
  provider_batch_item_id UUID REFERENCES ai_batch_items(id) ON DELETE SET NULL,
  confidence_score DECIMAL(5,4),
  justification TEXT,
  evidence JSONB DEFAULT '{}',
  rank INTEGER DEFAULT 1,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_translation_candidates_shop_term_status
  ON lex_translation_candidates(shop_id, term_id, status);
CREATE INDEX IF NOT EXISTS idx_lex_translation_candidates_cluster_rank
  ON lex_translation_candidates(cluster_id, rank);
CREATE INDEX IF NOT EXISTS idx_lex_translation_candidates_provider_batch_item
  ON lex_translation_candidates(provider_batch_item_id);

CREATE TABLE IF NOT EXISTS lex_translations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  translation_text TEXT NOT NULL,
  translation_kind VARCHAR(30) NOT NULL,
  quality_score DECIMAL(5,4),
  source_candidate_id UUID REFERENCES lex_translation_candidates(id) ON DELETE SET NULL,
  publication_status VARCHAR(20) DEFAULT 'draft',
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_translations_shop_term_cluster_lang
  ON lex_translations(shop_id, term_id, cluster_id, source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_lex_translations_publication_status ON lex_translations(publication_status);
CREATE INDEX IF NOT EXISTS idx_lex_translations_target_lang_kind ON lex_translations(target_lang, translation_kind);

CREATE TABLE IF NOT EXISTS lex_attribute_resolution_candidates (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL,
  definition_id UUID REFERENCES prod_attr_definitions(id) ON DELETE SET NULL,
  resolution_role VARCHAR(30) NOT NULL,
  confidence_score DECIMAL(5,4),
  evidence JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_attr_resolution_candidates_shop_term
  ON lex_attribute_resolution_candidates(shop_id, term_id);
CREATE INDEX IF NOT EXISTS idx_lex_attr_resolution_candidates_definition
  ON lex_attribute_resolution_candidates(definition_id);

CREATE TABLE IF NOT EXISTS lex_attribute_resolutions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES lex_terms(id) ON DELETE CASCADE,
  cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL,
  definition_id UUID NOT NULL REFERENCES prod_attr_definitions(id) ON DELETE CASCADE,
  resolution_role VARCHAR(30) NOT NULL,
  source_candidate_id UUID REFERENCES lex_attribute_resolution_candidates(id) ON DELETE SET NULL,
  confidence_score DECIMAL(5,4),
  status VARCHAR(20) DEFAULT 'approved',
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_attribute_resolutions_unique
  ON lex_attribute_resolutions(shop_id, term_id, cluster_id, definition_id, resolution_role);
CREATE INDEX IF NOT EXISTS idx_lex_attribute_resolutions_shop_term
  ON lex_attribute_resolutions(shop_id, term_id);
CREATE INDEX IF NOT EXISTS idx_lex_attribute_resolutions_definition_role
  ON lex_attribute_resolutions(definition_id, resolution_role);

-- ============================================
-- Review, localization and publication
-- ============================================

CREATE TABLE IF NOT EXISTS lex_review_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  run_id UUID REFERENCES lex_runs(id) ON DELETE SET NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  review_reason VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium',
  priority INTEGER DEFAULT 100,
  status VARCHAR(20) DEFAULT 'pending',
  assigned_to UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  evidence JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lex_review_items_shop_status_priority
  ON lex_review_items(shop_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_lex_review_items_shop_entity
  ON lex_review_items(shop_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS lex_decisions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  review_item_id UUID REFERENCES lex_review_items(id) ON DELETE SET NULL,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  decision_type VARCHAR(30) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  decided_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  decision_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_decisions_review_item ON lex_decisions(review_item_id);
CREATE INDEX IF NOT EXISTS idx_lex_decisions_shop_entity ON lex_decisions(shop_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS lex_entity_localizations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  title_text TEXT,
  description_text TEXT,
  description_short VARCHAR(500),
  seo_title VARCHAR(255),
  seo_description TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
  quality_score DECIMAL(5,4),
  publication_status VARCHAR(20) DEFAULT 'draft',
  content_hash VARCHAR(64) NOT NULL,
  source_run_id UUID REFERENCES lex_runs(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_entity_localizations_unique
  ON lex_entity_localizations(shop_id, entity_type, entity_id, source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_lex_entity_localizations_shop_status
  ON lex_entity_localizations(shop_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_lex_entity_localizations_shop_entity
  ON lex_entity_localizations(shop_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS lex_entity_localization_evidence (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  localization_id UUID NOT NULL REFERENCES lex_entity_localizations(id) ON DELETE CASCADE,
  fragment_id UUID REFERENCES lex_fragments(id) ON DELETE SET NULL,
  cluster_id UUID REFERENCES lex_sense_clusters(id) ON DELETE SET NULL,
  translation_id UUID REFERENCES lex_translations(id) ON DELETE SET NULL,
  source_order INTEGER DEFAULT 0,
  evidence_type VARCHAR(40) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_entity_localization_evidence_shop
  ON lex_entity_localization_evidence(shop_id);
CREATE INDEX IF NOT EXISTS idx_lex_entity_localization_evidence_localization
  ON lex_entity_localization_evidence(localization_id);
CREATE INDEX IF NOT EXISTS idx_lex_entity_localization_evidence_fragment
  ON lex_entity_localization_evidence(fragment_id);

CREATE TABLE IF NOT EXISTS lex_publication_targets (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  translation_id UUID REFERENCES lex_translations(id) ON DELETE SET NULL,
  localization_id UUID REFERENCES lex_entity_localizations(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  target_type VARCHAR(40) NOT NULL,
  target_record_id UUID,
  target_path TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  last_attempt_at TIMESTAMPTZ,
  attempt_count INTEGER DEFAULT 0,
  error_message TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_publication_targets_status ON lex_publication_targets(status);
CREATE INDEX IF NOT EXISTS idx_lex_publication_targets_shop_target
  ON lex_publication_targets(shop_id, target_type);

CREATE TABLE IF NOT EXISTS lex_publish_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  publication_target_id UUID NOT NULL REFERENCES lex_publication_targets(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_publish_events_target ON lex_publish_events(publication_target_id);
CREATE INDEX IF NOT EXISTS idx_lex_publish_events_shop_status ON lex_publish_events(shop_id, status);

CREATE TABLE IF NOT EXISTS lex_stopwords (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  locale VARCHAR(10) NOT NULL,
  word VARCHAR(255) NOT NULL,
  word_type VARCHAR(30) NOT NULL,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lex_stopwords_shop_locale_word
  ON lex_stopwords(shop_id, locale, word);

-- ============================================
-- RLS for operational tables
-- ============================================

DO $$
DECLARE
  tbl TEXT;
  operational_tables TEXT[] := ARRAY[
    'lex_shop_settings',
    'lex_runs',
    'lex_run_shards',
    'lex_checkpoints',
    'lex_fragments',
    'lex_fragment_entities',
    'lex_fragment_annotations',
    'lex_term_occurrences',
    'lex_term_stats',
    'lex_term_contexts',
    'lex_context_embeddings',
    'lex_review_items',
    'lex_decisions',
    'lex_entity_localizations',
    'lex_entity_localization_evidence',
    'lex_publication_targets',
    'lex_publish_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY operational_tables LOOP
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

-- ============================================
-- updated_at triggers
-- ============================================

DO $$
DECLARE
  tbl TEXT;
  triggered_tables TEXT[] := ARRAY[
    'lex_shop_settings',
    'lex_runs',
    'lex_checkpoints',
    'lex_term_variants',
    'lex_term_stats',
    'lex_term_contexts',
    'lex_sense_clusters',
    'lex_domain_profiles',
    'lex_glossary_entries',
    'lex_translation_rules',
    'lex_translation_candidates',
    'lex_translations',
    'lex_attribute_resolution_candidates',
    'lex_attribute_resolutions',
    'lex_review_items',
    'lex_entity_localizations',
    'lex_publication_targets'
  ];
BEGIN
  FOREACH tbl IN ARRAY triggered_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || tbl || '_updated_at', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      'trg_' || tbl || '_updated_at',
      tbl
    );
  END LOOP;
END $$;

-- ============================================
-- Seed feature flags for Module N rollout
-- ============================================

INSERT INTO feature_flags (flag_key, description, default_value, is_active, rollout_percentage)
VALUES
  ('lex_module_enabled', 'Enable the lexical intelligence module and /pim/lex APIs', false, true, 0),
  ('lex_review_ui_enabled', 'Enable the PIM translations review UI', false, true, 0),
  ('lex_collection_adapter_enabled', 'Route collection translation through approved lexical localizations when available', false, true, 0),
  ('lex_auto_publish_products_enabled', 'Allow auto-publication from approved product localizations into prod_translations', false, true, 0),
  ('lex_auto_publish_attributes_enabled', 'Allow auto-publication from approved attribute resolutions into prod_attr_synonyms', false, true, 0),
  ('lex_auto_publish_collections_enabled', 'Allow auto-publication from approved collection localizations into shopify_collections title_en/description_en', false, true, 0)
ON CONFLICT (flag_key)
DO UPDATE SET
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value,
  is_active = EXCLUDED.is_active,
  rollout_percentage = EXCLUDED.rollout_percentage,
  updated_at = now();
