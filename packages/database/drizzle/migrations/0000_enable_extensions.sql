-- ============================================
-- Migration: 0000_enable_extensions.sql
-- Task: F2.1.2.1 - Activare extensii PostgreSQL baseline
-- ============================================
-- Enterprise DB Setup: Prima migrație - activează extensiile necesare
-- TREBUIE rulată ÎNAINTE de orice altă schemă!
--
-- NOTĂ: Funcția uuidv7() este implementată manual mai jos.
--       PostgreSQL nu are uuidv7() nativ încă.
-- ============================================

-- ============================================
-- CORE EXTENSIONS (OBLIGATORII)
-- ============================================

-- pgcrypto: Funcții criptografice pentru criptare tokens, hash parole
-- Folosit în: shopify_tokens (AES-256-GCM encryption)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- UUIDV7 FUNCTION (Required for all id columns)
-- ============================================
-- PostgreSQL nu are uuidv7() nativ. Această funcție generează
-- UUIDs v7 conform RFC 9562 cu timestamp și randomness.
-- Necesar pentru toate coloanele id cu DEFAULT uuidv7()

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  random_bytes bytea;
  uuid_bytes bytea;
BEGIN
  -- Get current timestamp in milliseconds since Unix epoch
  unix_ts_ms := int8send((extract(epoch from clock_timestamp()) * 1000)::bigint);
  
  -- Generate 10 random bytes
  random_bytes := gen_random_bytes(10);
  
  -- Combine: 6 bytes timestamp + 2 bytes random with version + 8 bytes random with variant
  uuid_bytes := substring(unix_ts_ms from 3 for 6) ||  -- 6 bytes of timestamp
                set_byte(set_bit(substring(random_bytes from 1 for 2), 5, 1), 0,
                         (get_byte(substring(random_bytes from 1 for 2), 0) & 15) | 112) ||  -- version 7
                set_byte(substring(random_bytes from 3 for 8), 0,
                         (get_byte(substring(random_bytes from 3 for 8), 0) & 63) | 128);  -- variant 10
  
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- citext: Case-Insensitive Text type
-- Folosit în: shopify_domain, email, handle (căutări case-insensitive)
CREATE EXTENSION IF NOT EXISTS "citext";

-- pg_trgm: Trigram similarity pentru fuzzy search
-- Folosit în: căutare produse, autosuggest, matching SKU
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- btree_gin: GIN index support pentru tipuri scalare
-- Folosit în: indexuri composite pe JSONB + scalar columns
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- btree_gist: GiST index support pentru exclusion constraints
-- Folosit în: scheduling, range queries, temporal data
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================
-- VECTOR SEARCH (OBLIGATORIU pentru PIM)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================
-- MONITORING (OPȚIONAL - recomandat pentru production)
-- ============================================
-- NOTĂ: Aceste extensii necesită superuser și pot fi dezactivate în dev

-- pg_stat_statements: Query performance monitoring
-- Doar activează dacă nu există deja (evită erori în dev containers)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    -- Poate eșua în containere fără shared_preload_libraries configurat
    -- În acest caz, e OK să sărim
    BEGIN
      CREATE EXTENSION "pg_stat_statements";
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_stat_statements skipped (shared_preload_libraries not configured)';
    END;
  END IF;
END $$;

-- ============================================
-- DECIZIE PARTITIONARE (F2.1.2.1 requirement)
-- ============================================
-- DOCUMENTAT: Pentru 1M+ SKU, partitionarea după shop_id crește performanța.
-- DECIZIE: Implementăm partitionare în PR-008 (core-schema) pentru tabelele:
-- - products (BY LIST pe shop_id sau BY HASH)
-- - inventory_movements (BY RANGE pe created_at)
-- Motivație amânare: Partitionarea necesită schema definită mai întâi.
-- ============================================

-- Verificare finală: log extensiile activate
DO $$
DECLARE
  ext_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO ext_count 
  FROM pg_extension 
  WHERE extname IN ('pgcrypto', 'citext', 'pg_trgm', 'btree_gin', 'btree_gist', 'vector');
  
  IF ext_count >= 6 THEN
    RAISE NOTICE '✅ All 6 core extensions activated successfully';
  ELSE
    RAISE WARNING '⚠️ Only % of 6 core extensions activated', ext_count;
  END IF;
END $$;
