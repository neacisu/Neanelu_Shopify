-- Neanelu PIM Database Schema (PostgreSQL 18.1)
-- Strategy: Vertical Partitioning + Global Research Harvesting

-- UUIDv7 is native in PostgreSQL 18.1
-- No extension required for uuidv7() function

-- Enable pgvector (required for F8.3.1 / PIM vectors)
CREATE EXTENSION IF NOT EXISTS "vector";

-- ==========================================
-- 1. CORE IDENTITY (Immutable, Internal)
-- ==========================================
CREATE TABLE prod_master (
    id UUID PRIMARY KEY DEFAULT uuidv7(), -- Native PG18 UUIDv7
    sku VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('simple', 'variant', 'bundle')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- 2. SEMANTIC KNOWLEDGE (AI & Search Ready)
-- ==========================================
CREATE TABLE prod_semantics (
    product_id UUID PRIMARY KEY REFERENCES prod_master(id) ON DELETE CASCADE,
    
    -- The "Wikipedia" content
    title_master TEXT NOT NULL,
    description_master TEXT, -- clean HTML
    
    -- AI Generated / Enhanced
    ai_summary TEXT, -- Short summary for snippets
    keywords_graph JSONB, -- {"nodes": ["jacket", "winter"], "edges": [...]}
    
    -- Structured Data for SEO
    json_ld_schema JSONB, -- Pre-computed Schema.org object
    
    -- Search & Vector
    search_vector TSVECTOR, -- Postgres Full Text Search
    vector_embedding VECTOR(1536) -- Optional: for semantic search (pgvector)
);

-- Vector extension moved to top

-- 1. LEVEL 1: TAXONOMY & GOVERNANCE
-- "Creierul" sistemului. Importat din Shopify Standard Taxonomy.

CREATE TABLE prod_taxonomy (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    parent_id UUID REFERENCES prod_taxonomy(id), -- Changed UUIDv7 to UUID
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    breadcrumbs TEXT,
    
    -- Ce atribute sunt permise? (Schema Validation)
    -- Ex: {"required": ["screen_size"], "optional": ["water_proof"]}
    attribute_schema JSONB, 
    
    external_mappings JSONB, -- {"google_id": 123, "meta_id": "files"}
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add taxonomy reference to prod_master (Circular dependency resolution)
ALTER TABLE prod_master ADD COLUMN taxonomy_id UUID REFERENCES prod_taxonomy(id);

-- Registrul Atributelor Canonice (Standardizate)
CREATE TABLE prod_attr_definitions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    code VARCHAR(100) UNIQUE, -- 'screen_size_inch'
    label VARCHAR(255),       -- 'Diagonala Ecran (Inch)'
    data_type VARCHAR(20),    -- 'number', 'bool', 'string', 'enum'
    embedding vector(1536)    -- Pentru căutare semantică (Fuzzy Match)
);

-- Sinonime Învățate (ex: 'marime ecran' -> 'screen_size_inch')
CREATE TABLE prod_attr_synonyms (
    synonym_text TEXT PRIMARY KEY,
    definition_id UUID REFERENCES prod_attr_definitions(id), -- Changed UUIDv7 to UUID
    confidence_score FLOAT
);


-- 2. LEVEL 2: INGESTION (DATA LAKE)
-- Date brute, nealterate.

CREATE TABLE prod_sources_registry (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) UNIQUE,
    reliability_score INT
);

CREATE TABLE prod_raw_harvest (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    source_id INT REFERENCES prod_sources_registry(id),
    target_sku VARCHAR(100), -- SKU-ul căutat
    
    -- Payload complet
    raw_html TEXT,
    raw_json JSONB,
    
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    processing_status VARCHAR(20) DEFAULT 'pending'
);


-- 3. LEVEL 3: PROCESS & CONSENSUS
-- Zona de lucru AI.

CREATE TABLE prod_extraction_sessions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    raw_harvest_id UUID REFERENCES prod_raw_harvest(id), -- Changed UUIDv7 to UUID
    agent_version VARCHAR(50), -- 'gpt-4o-extractor-v2'
    
    -- Rezultatul extracției
    extracted_specs JSONB, -- {"screen_size": 6.1, "color": "black"}
    grounding_snippets JSONB -- {"screen_size": "citat din text: ecran de 6.1 inci"}
);


-- 4. LEVEL 4: GOLDEN RECORD
-- Produsul final.

-- prod_master definition removed (merged into top definition)

-- Specificațiile Validate (EAV pentru filtrare sau JSONB cu validare)
CREATE TABLE prod_specs (
    product_id UUID REFERENCES prod_master(id), -- Changed UUIDv7 to UUID
    spec_data JSONB, -- {"screen_size_inch": 6.1, "weight_kg": 0.2}
    
    -- Metadate despre cine a decis valoarea
    provenance JSONB, -- {"screen_size_inch": {"source": "consensus", "confidence": 0.99}}
    
    PRIMARY KEY (product_id)
);

CREATE TABLE prod_channel_mappings (
    product_id UUID REFERENCES prod_master(id), -- Changed UUIDv7 to UUID
    channel VARCHAR(50), -- 'shopify', 'google'
    external_id VARCHAR(255),
    sync_status VARCHAR(20) DEFAULT 'dirty', -- dirty, synced, error
    last_pushed_at TIMESTAMPTZ,
    channel_meta JSONB -- Store shopify-specific flags
);

-- Google Merchant Center
CREATE TABLE prod_map_gmc (
    product_id UUID PRIMARY KEY REFERENCES prod_master(id) ON DELETE CASCADE,
    gmc_category_id INT,
    custom_labels JSONB, -- {"0": "Summer", "1": "BestSeller"}
    sync_status VARCHAR(20) DEFAULT 'dirty'
);

-- Meta (Facebook/Instagram)
CREATE TABLE prod_map_meta (
    product_id UUID PRIMARY KEY REFERENCES prod_master(id) ON DELETE CASCADE,
    fb_content_id VARCHAR(100),
    sync_status VARCHAR(20) DEFAULT 'dirty'
);

