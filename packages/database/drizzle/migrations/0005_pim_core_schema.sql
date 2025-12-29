-- ============================================
-- Migration: 0005_pim_core_schema.sql
-- Task: F2.2.5 - PIM Core Schema (4-Layer Architecture)
-- PR-010: PIM Schema & pgvector Embeddings
-- ============================================
-- CONFORM: Database_Schema_Complete.md v2.6 - Module D
--
-- ARHITECTURĂ:
-- 1. Governance Layer: prod_taxonomy
-- 2. Raw Ingestion Layer: prod_sources, prod_raw_harvest
-- 3. Process Layer: prod_extraction_sessions
-- 4. Golden Record Layer: prod_master, prod_specs_normalized, prod_semantics
-- 5. Channel Mapping: prod_channel_mappings
--
-- NOTĂ CRITICĂ: Aceste tabele NU au RLS - sunt date globale PIM.
-- ============================================

-- ============================================
-- 1. GOVERNANCE LAYER: prod_taxonomy
-- ============================================

CREATE TABLE prod_taxonomy (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    parent_id UUID REFERENCES prod_taxonomy(id) ON DELETE SET NULL,
    
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    
    breadcrumbs TEXT[],
    level INTEGER NOT NULL DEFAULT 0,
    
    attribute_schema JSONB DEFAULT '{}',
    validation_rules JSONB DEFAULT '{}',
    
    external_mappings JSONB DEFAULT '{}',
    shopify_taxonomy_id VARCHAR(100),
    
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_taxonomy_parent ON prod_taxonomy(parent_id);
CREATE UNIQUE INDEX idx_taxonomy_slug ON prod_taxonomy(slug);
CREATE INDEX idx_taxonomy_shopify ON prod_taxonomy(shopify_taxonomy_id) WHERE shopify_taxonomy_id IS NOT NULL;
CREATE INDEX idx_taxonomy_breadcrumbs ON prod_taxonomy USING GIN(breadcrumbs);

-- ============================================
-- 2. RAW INGESTION LAYER: prod_sources
-- ============================================

CREATE TABLE prod_sources (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    name VARCHAR(100) NOT NULL UNIQUE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('SUPPLIER', 'MANUFACTURER', 'SCRAPER', 'API', 'MANUAL')),
    
    base_url TEXT,
    priority INTEGER DEFAULT 50,
    trust_score DECIMAL(3,2) DEFAULT 0.5 CHECK (trust_score >= 0 AND trust_score <= 1),
    
    config JSONB DEFAULT '{}',
    rate_limit JSONB,
    auth_config JSONB,
    
    is_active BOOLEAN DEFAULT true,
    last_harvest_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_sources_name ON prod_sources(name);
CREATE INDEX idx_sources_type ON prod_sources(source_type);
CREATE INDEX idx_sources_active ON prod_sources(is_active) WHERE is_active = true;

-- ============================================
-- 2. RAW INGESTION LAYER: prod_raw_harvest
-- ============================================

CREATE TABLE prod_raw_harvest (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    source_id UUID NOT NULL REFERENCES prod_sources(id) ON DELETE CASCADE,
    
    target_sku VARCHAR(100),
    source_url TEXT NOT NULL,
    source_product_id VARCHAR(255),
    
    raw_html TEXT,
    raw_json JSONB,
    
    http_status INTEGER,
    response_headers JSONB,
    
    fetched_at TIMESTAMPTZ DEFAULT now(),
    
    processing_status VARCHAR(20) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed')),
    processing_error TEXT,
    processed_at TIMESTAMPTZ,
    
    content_hash VARCHAR(64),
    ttl_expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_harvest_source ON prod_raw_harvest(source_id);
CREATE INDEX idx_harvest_status ON prod_raw_harvest(processing_status);
CREATE INDEX idx_harvest_sku ON prod_raw_harvest(target_sku) WHERE target_sku IS NOT NULL;
CREATE INDEX idx_harvest_url ON prod_raw_harvest(source_url);
CREATE INDEX idx_harvest_hash ON prod_raw_harvest(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_harvest_pending ON prod_raw_harvest(created_at) WHERE processing_status = 'pending';

-- ============================================
-- 3. PROCESS LAYER: prod_extraction_sessions
-- ============================================

CREATE TABLE prod_extraction_sessions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    harvest_id UUID NOT NULL REFERENCES prod_raw_harvest(id) ON DELETE CASCADE,
    
    agent_version VARCHAR(50) NOT NULL,
    model_name VARCHAR(100),
    
    extracted_specs JSONB NOT NULL,
    grounding_snippets JSONB,
    
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    field_confidences JSONB,
    
    tokens_used INTEGER,
    latency_ms INTEGER,
    
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_extraction_harvest ON prod_extraction_sessions(harvest_id);
CREATE INDEX idx_extraction_confidence ON prod_extraction_sessions(confidence_score) WHERE confidence_score IS NOT NULL;
CREATE INDEX idx_extraction_specs ON prod_extraction_sessions USING GIN(extracted_specs jsonb_path_ops);

-- ============================================
-- 4. GOLDEN RECORD LAYER: prod_master
-- ============================================

CREATE TABLE prod_master (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    internal_sku VARCHAR(100) NOT NULL UNIQUE,
    canonical_title TEXT NOT NULL,
    
    brand VARCHAR(255),
    manufacturer VARCHAR(255),
    mpn VARCHAR(100),
    gtin VARCHAR(14),
    
    taxonomy_id UUID REFERENCES prod_taxonomy(id) ON DELETE SET NULL,
    
    dedupe_status VARCHAR(20) DEFAULT 'unique' CHECK (dedupe_status IN ('unique', 'merged', 'duplicate')),
    dedupe_cluster_id UUID,
    
    primary_source_id UUID REFERENCES prod_sources(id) ON DELETE SET NULL,
    
    lifecycle_status VARCHAR(20) DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'discontinued', 'draft')),
    
    data_quality_level VARCHAR(20) NOT NULL DEFAULT 'bronze' 
        CHECK (data_quality_level IN ('bronze', 'silver', 'golden', 'review_needed')),
    quality_score DECIMAL(3,2) CHECK (quality_score >= 0 AND quality_score <= 1),
    quality_score_breakdown JSONB DEFAULT '{}',
    last_quality_check TIMESTAMPTZ,
    promoted_to_silver_at TIMESTAMPTZ,
    promoted_to_golden_at TIMESTAMPTZ,
    
    needs_review BOOLEAN DEFAULT false,
    review_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_master_sku ON prod_master(internal_sku);
CREATE INDEX idx_master_brand ON prod_master(brand) WHERE brand IS NOT NULL;
CREATE INDEX idx_master_taxonomy ON prod_master(taxonomy_id) WHERE taxonomy_id IS NOT NULL;
CREATE INDEX idx_master_gtin ON prod_master(gtin) WHERE gtin IS NOT NULL;
CREATE INDEX idx_master_mpn ON prod_master(manufacturer, mpn) WHERE mpn IS NOT NULL;
CREATE INDEX idx_master_review ON prod_master(needs_review) WHERE needs_review = true;
CREATE INDEX idx_master_quality_level ON prod_master(data_quality_level);
CREATE INDEX idx_master_bronze ON prod_master(id) WHERE data_quality_level = 'bronze';
CREATE INDEX idx_master_silver ON prod_master(id) WHERE data_quality_level = 'silver';
CREATE INDEX idx_master_golden ON prod_master(id) WHERE data_quality_level = 'golden';

-- ============================================
-- 4. GOLDEN RECORD LAYER: prod_specs_normalized
-- ============================================

CREATE TABLE prod_specs_normalized (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
    
    specs JSONB NOT NULL,
    raw_specs JSONB,
    
    provenance JSONB NOT NULL,
    
    version INTEGER NOT NULL DEFAULT 1,
    is_current BOOLEAN DEFAULT true,
    
    needs_review BOOLEAN DEFAULT false,
    review_reason VARCHAR(100),
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_specs_product ON prod_specs_normalized(product_id);
CREATE INDEX idx_specs_current ON prod_specs_normalized(product_id) WHERE is_current = true;
CREATE INDEX idx_specs_data ON prod_specs_normalized USING GIN(specs jsonb_path_ops);
CREATE INDEX idx_specs_review ON prod_specs_normalized(needs_review) WHERE needs_review = true;

-- ============================================
-- 4. GOLDEN RECORD LAYER: prod_semantics
-- ============================================

CREATE TABLE prod_semantics (
    product_id UUID PRIMARY KEY REFERENCES prod_master(id) ON DELETE CASCADE,
    
    title_master TEXT NOT NULL,
    description_master TEXT,
    description_short VARCHAR(500),
    
    ai_summary TEXT,
    
    keywords TEXT[],
    keywords_graph JSONB,
    
    json_ld_schema JSONB,
    
    search_vector TSVECTOR,
    
    locale VARCHAR(10) DEFAULT 'ro',
    
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_semantics_fts ON prod_semantics USING GIN(search_vector);
CREATE INDEX idx_semantics_keywords ON prod_semantics USING GIN(keywords);
CREATE INDEX idx_semantics_locale ON prod_semantics(locale);

-- Trigger pentru actualizare automată search_vector
CREATE OR REPLACE FUNCTION update_prod_semantics_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', 
        COALESCE(NEW.title_master, '') || ' ' || 
        COALESCE(NEW.description_master, '') || ' ' ||
        COALESCE(NEW.description_short, '') || ' ' ||
        COALESCE(array_to_string(NEW.keywords, ' '), '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prod_semantics_search_vector
    BEFORE INSERT OR UPDATE ON prod_semantics
    FOR EACH ROW
    EXECUTE FUNCTION update_prod_semantics_search_vector();

-- ============================================
-- 5. CHANNEL MAPPING: prod_channel_mappings
-- ============================================

CREATE TABLE prod_channel_mappings (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
    
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('shopify', 'google', 'facebook', 'amazon', 'other')),
    
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    
    sync_status VARCHAR(20) DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'error', 'manual')),
    
    last_pushed_at TIMESTAMPTZ,
    last_pulled_at TIMESTAMPTZ,
    
    channel_meta JSONB DEFAULT '{}',
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_channel_product ON prod_channel_mappings(product_id);
CREATE UNIQUE INDEX idx_channel_external ON prod_channel_mappings(channel, shop_id, external_id);
CREATE INDEX idx_channel_status ON prod_channel_mappings(channel, sync_status);
CREATE INDEX idx_channel_shop ON prod_channel_mappings(shop_id) WHERE shop_id IS NOT NULL;

-- ============================================
-- VERIFICARE FINALĂ
-- ============================================

DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
        'prod_taxonomy', 'prod_sources', 'prod_raw_harvest',
        'prod_extraction_sessions', 'prod_master', 'prod_specs_normalized',
        'prod_semantics', 'prod_channel_mappings'
    );
    
    IF table_count = 8 THEN
        RAISE NOTICE '✅ All 8 PIM tables created successfully';
    ELSE
        RAISE WARNING '⚠️ Only % of 8 PIM tables created', table_count;
    END IF;
END $$;
