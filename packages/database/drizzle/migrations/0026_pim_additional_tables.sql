-- Migration: 0026_pim_additional_tables.sql
-- Purpose: Add missing PIM tables: prod_proposals, prod_dedupe_*, prod_similarity_matches, prod_quality_events, prod_translations

-- ============================================
-- Table: prod_proposals
-- Purpose: Golden Record enhancement proposals
-- ============================================
CREATE TABLE IF NOT EXISTS prod_proposals (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  current_value JSONB,
  proposed_value JSONB NOT NULL,
  extraction_session_id UUID REFERENCES prod_extraction_sessions(id),
  source_id UUID REFERENCES prod_sources(id),
  confidence_score DECIMAL(3,2),
  proposal_status VARCHAR(20) DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  reviewed_by UUID REFERENCES staff_users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  auto_approved BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_proposal_status CHECK (proposal_status IN ('pending', 'approved', 'rejected', 'merged', 'superseded'))
);

CREATE INDEX idx_proposals_product ON prod_proposals(product_id, proposal_status);
CREATE INDEX idx_proposals_pending ON prod_proposals(proposal_status, priority DESC) WHERE proposal_status = 'pending';
CREATE INDEX idx_proposals_field ON prod_proposals(product_id, field_path);
CREATE INDEX idx_proposals_source ON prod_proposals(source_id);
CREATE INDEX idx_proposals_expires ON prod_proposals(expires_at) WHERE proposal_status = 'pending';

CREATE TRIGGER trg_prod_proposals_updated_at
  BEFORE UPDATE ON prod_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: prod_dedupe_clusters
-- ============================================
CREATE TABLE IF NOT EXISTS prod_dedupe_clusters (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  cluster_type VARCHAR(30) NOT NULL,
  match_criteria JSONB NOT NULL,
  canonical_product_id UUID REFERENCES prod_master(id),
  member_count INTEGER DEFAULT 1,
  confidence_score DECIMAL(3,2),
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID REFERENCES staff_users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_cluster_type CHECK (cluster_type IN ('EXACT_MATCH', 'FUZZY', 'SEMANTIC')),
  CONSTRAINT chk_cluster_status CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged'))
);

CREATE INDEX idx_clusters_canonical ON prod_dedupe_clusters(canonical_product_id);
CREATE INDEX idx_clusters_status ON prod_dedupe_clusters(status, confidence_score DESC);
CREATE INDEX idx_clusters_type ON prod_dedupe_clusters(cluster_type, status);

CREATE TRIGGER trg_prod_dedupe_clusters_updated_at
  BEFORE UPDATE ON prod_dedupe_clusters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: prod_dedupe_cluster_members
-- ============================================
CREATE TABLE IF NOT EXISTS prod_dedupe_cluster_members (
  cluster_id UUID NOT NULL REFERENCES prod_dedupe_clusters(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
  similarity_score DECIMAL(5,4),
  match_fields JSONB,
  is_canonical BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  PRIMARY KEY (cluster_id, product_id)
);

CREATE INDEX idx_cluster_members_product ON prod_dedupe_cluster_members(product_id);
CREATE INDEX idx_cluster_members_similarity ON prod_dedupe_cluster_members(cluster_id, similarity_score DESC);

-- ============================================
-- Table: prod_similarity_matches
-- Purpose: External product matches from web research
-- ============================================
CREATE TABLE IF NOT EXISTS prod_similarity_matches (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  product_id UUID REFERENCES prod_master(id) ON DELETE CASCADE,
  source_id UUID REFERENCES prod_sources(id),
  source_url TEXT NOT NULL,
  source_title TEXT,
  source_gtin VARCHAR(50),
  source_sku VARCHAR(100),
  source_price DECIMAL(12,2),
  source_currency VARCHAR(3),
  source_data JSONB,
  similarity_score DECIMAL(3,2) NOT NULL,
  match_method VARCHAR(50) NOT NULL,
  match_confidence VARCHAR(20) DEFAULT 'pending',
  is_primary_source BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES staff_users(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_similarity_confidence CHECK (match_confidence IN ('pending', 'confirmed', 'rejected'))
);

CREATE INDEX idx_similarity_product ON prod_similarity_matches(product_id, similarity_score DESC);
CREATE INDEX idx_similarity_source ON prod_similarity_matches(source_id);
CREATE INDEX idx_similarity_gtin ON prod_similarity_matches(source_gtin) WHERE source_gtin IS NOT NULL;
CREATE INDEX idx_similarity_score ON prod_similarity_matches(similarity_score DESC) WHERE similarity_score >= 0.95;
CREATE INDEX idx_similarity_pending ON prod_similarity_matches(match_confidence) WHERE match_confidence = 'pending';

CREATE TRIGGER trg_prod_similarity_matches_updated_at
  BEFORE UPDATE ON prod_similarity_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: prod_quality_events
-- Purpose: Quality level change audit trail
-- ============================================
CREATE TABLE IF NOT EXISTS prod_quality_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  previous_level VARCHAR(20),
  new_level VARCHAR(20) NOT NULL,
  quality_score_before DECIMAL(3,2),
  quality_score_after DECIMAL(3,2),
  trigger_reason VARCHAR(100) NOT NULL,
  trigger_details JSONB DEFAULT '{}',
  triggered_by UUID REFERENCES staff_users(id),
  job_id VARCHAR(255),
  webhook_sent BOOLEAN DEFAULT false,
  webhook_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT chk_quality_event_type CHECK (event_type IN ('quality_promoted', 'quality_demoted', 'review_requested')),
  CONSTRAINT chk_quality_level CHECK (new_level IN ('bronze', 'silver', 'golden', 'review_needed'))
);

CREATE INDEX idx_quality_events_product ON prod_quality_events(product_id, created_at DESC);
CREATE INDEX idx_quality_events_type ON prod_quality_events(event_type, created_at DESC);
CREATE INDEX idx_quality_events_level ON prod_quality_events(new_level, created_at DESC);
CREATE INDEX idx_quality_events_pending_webhook ON prod_quality_events(created_at) WHERE webhook_sent = false;

-- ============================================
-- Table: prod_translations
-- ============================================
CREATE TABLE IF NOT EXISTS prod_translations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
  locale VARCHAR(10) NOT NULL,
  title TEXT,
  description TEXT,
  description_short VARCHAR(500),
  keywords TEXT[],
  seo_title VARCHAR(255),
  seo_description TEXT,
  translation_source VARCHAR(30),
  quality_score DECIMAL(3,2),
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_translations_product_locale ON prod_translations(product_id, locale);
CREATE INDEX idx_translations_locale ON prod_translations(locale, is_approved);

CREATE TRIGGER trg_prod_translations_updated_at
  BEFORE UPDATE ON prod_translations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
