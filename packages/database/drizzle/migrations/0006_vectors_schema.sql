-- ============================================
-- Migration: 0006_vectors_schema.sql
-- Task: F2.2.7 - pgvector Embeddings Schema
-- PR-010: PIM Schema & pgvector Embeddings
-- ============================================
-- CONFORM: Database_Schema_Complete.md v2.6 - Module E
--
-- DECIZIE ARHITECTURALĂ:
-- - pgvector este SINGURA soluție de vector storage
-- - Redis NU se folosește pentru vectori
-- - HNSW indexes pentru performanță (<10ms latency)
--
-- PARAMETRI HNSW:
-- - Attributes (<100K): m=16, ef_construction=64
-- - Products (>1M): m=32, ef_construction=128
-- ============================================

-- Verificare extensie vector (trebuie să existe din 0000)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION 'pgvector extension not found! Please run 0000_enable_extensions.sql first.';
    END IF;
END $$;

-- ============================================
-- 1. prod_attr_definitions - Canonical Attribute Registry
-- ============================================

CREATE TABLE prod_attr_definitions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    code VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    description TEXT,
    
    data_type VARCHAR(30) NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'enum', 'array', 'object')),
    unit VARCHAR(50),
    unit_family VARCHAR(50),
    
    allowed_values JSONB,
    validation_regex VARCHAR(255),
    
    is_required BOOLEAN DEFAULT false,
    is_variant_level BOOLEAN DEFAULT false,
    is_searchable BOOLEAN DEFAULT true,
    is_filterable BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    -- Vector embedding pentru căutare semantică
    embedding vector(1536),
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_attr_code ON prod_attr_definitions(code);
CREATE INDEX idx_attr_type ON prod_attr_definitions(data_type);
CREATE INDEX idx_attr_searchable ON prod_attr_definitions(is_searchable) WHERE is_searchable = true;

-- HNSW index pentru attribute embeddings (m=16, ef_construction=64 pentru <100K items)
CREATE INDEX idx_attr_embedding ON prod_attr_definitions 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================
-- 2. prod_attr_synonyms - Synonym Mapping
-- ============================================

CREATE TABLE prod_attr_synonyms (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    definition_id UUID NOT NULL REFERENCES prod_attr_definitions(id) ON DELETE CASCADE,
    
    synonym_text VARCHAR(255) NOT NULL,
    locale VARCHAR(10) DEFAULT 'ro',
    
    source VARCHAR(50) CHECK (source IN ('manual', 'ai', 'import')),
    confidence_score DECIMAL(3,2) DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    is_approved BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_synonyms_definition ON prod_attr_synonyms(definition_id);
CREATE INDEX idx_synonyms_text ON prod_attr_synonyms(synonym_text);
CREATE INDEX idx_synonyms_locale ON prod_attr_synonyms(locale);

-- Trigram index pentru fuzzy text search
CREATE INDEX idx_synonyms_text_trgm ON prod_attr_synonyms USING GIN(synonym_text gin_trgm_ops);

-- ============================================
-- 3. prod_embeddings - Global PIM Product Embeddings
-- ============================================
-- NO RLS - Global PIM data

CREATE TABLE prod_embeddings (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    product_id UUID NOT NULL REFERENCES prod_master(id) ON DELETE CASCADE,
    
    embedding_type VARCHAR(50) NOT NULL CHECK (embedding_type IN ('title', 'description', 'specs', 'combined', 'title_brand')),
    
    -- Vector embedding (OpenAI text-embedding-3-small = 1536 dimensions)
    embedding vector(1536) NOT NULL,
    
    content_hash VARCHAR(64) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    dimensions INTEGER DEFAULT 1536,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Un singur embedding per tip per produs
    UNIQUE(product_id, embedding_type)
);

CREATE INDEX idx_embeddings_product ON prod_embeddings(product_id);
CREATE INDEX idx_embeddings_type ON prod_embeddings(product_id, embedding_type);
CREATE INDEX idx_embeddings_hash ON prod_embeddings(content_hash);

-- HNSW index pentru product embeddings (m=32, ef_construction=128 pentru >1M items)
CREATE INDEX idx_embeddings_vector ON prod_embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 32, ef_construction = 128);

-- ============================================
-- 4. shop_product_embeddings - Per-Tenant Embeddings
-- ============================================
-- HAS RLS - Multi-tenant data

CREATE TABLE shop_product_embeddings (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES shopify_products(id) ON DELETE CASCADE,
    
    embedding_type VARCHAR(50) NOT NULL CHECK (embedding_type IN ('title', 'description', 'combined')),
    
    -- Vector embedding
    embedding vector(1536) NOT NULL,
    
    content_hash VARCHAR(64) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    dimensions INTEGER DEFAULT 1536,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    error_message TEXT,
    
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_shop_embeddings_product ON shop_product_embeddings(shop_id, product_id, embedding_type, model_version);
CREATE INDEX idx_shop_embeddings_hash ON shop_product_embeddings(shop_id, content_hash);
CREATE INDEX idx_shop_embeddings_pending ON shop_product_embeddings(shop_id, status) WHERE status = 'pending';
CREATE INDEX idx_shop_embeddings_ready ON shop_product_embeddings(shop_id) WHERE status = 'ready';

-- HNSW index pentru shop embeddings (m=24, ef_construction=128 pentru căutare per-tenant)
CREATE INDEX idx_shop_embeddings_vector ON shop_product_embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 128);

-- ============================================
-- RLS pentru shop_product_embeddings (SINGURA tabelă cu RLS din acest modul)
-- ============================================

ALTER TABLE shop_product_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_product_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY shop_embeddings_tenant_isolation ON shop_product_embeddings
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

-- ============================================
-- HELPER FUNCTION: find_similar_products
-- ============================================
-- Funcție pentru căutare vectorială rapidă cu threshold și limit

CREATE OR REPLACE FUNCTION find_similar_products(
    query_embedding vector(1536),
    similarity_threshold float DEFAULT 0.95,
    max_results int DEFAULT 10
)
RETURNS TABLE (
    product_id uuid,
    embedding_type varchar(50),
    similarity float
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.product_id,
        e.embedding_type,
        (1 - (e.embedding <=> query_embedding))::float as similarity
    FROM prod_embeddings e
    WHERE e.embedding_type = 'title_brand'
        AND (e.embedding <=> query_embedding) < (1 - similarity_threshold)
    ORDER BY e.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- HELPER FUNCTION: find_similar_shop_products
-- ============================================
-- Funcție pentru căutare vectorială per-tenant

CREATE OR REPLACE FUNCTION find_similar_shop_products(
    p_shop_id uuid,
    query_embedding vector(1536),
    similarity_threshold float DEFAULT 0.9,
    max_results int DEFAULT 20
)
RETURNS TABLE (
    product_id uuid,
    embedding_type varchar(50),
    similarity float
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.product_id,
        e.embedding_type,
        (1 - (e.embedding <=> query_embedding))::float as similarity
    FROM shop_product_embeddings e
    WHERE e.shop_id = p_shop_id
        AND e.status = 'ready'
        AND (e.embedding <=> query_embedding) < (1 - similarity_threshold)
    ORDER BY e.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- VERIFICARE FINALĂ
-- ============================================

DO $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
BEGIN
    -- Verificare tabele
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
        'prod_attr_definitions', 'prod_attr_synonyms',
        'prod_embeddings', 'shop_product_embeddings'
    );
    
    -- Verificare indexuri HNSW
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE indexdef LIKE '%hnsw%';
    
    IF table_count = 4 THEN
        RAISE NOTICE '✅ All 4 vector tables created successfully';
    ELSE
        RAISE WARNING '⚠️ Only % of 4 vector tables created', table_count;
    END IF;
    
    IF index_count >= 3 THEN
        RAISE NOTICE '✅ HNSW indexes created: %', index_count;
    ELSE
        RAISE WARNING '⚠️ Only % HNSW indexes created (expected 3+)', index_count;
    END IF;
END $$;
