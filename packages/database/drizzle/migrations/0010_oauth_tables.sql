-- Migration: 0010_oauth_tables.sql
-- PR-011: F2.2.8 - OAuth Tables
-- Description: CSRF protection for OAuth flow
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module A: System Core
-- NO RLS: Pre-authentication data

-- ============================================
-- Table: oauth_states
-- CSRF state tokens for OAuth flow (TTL ~10 min)
-- ============================================
CREATE TABLE oauth_states (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    state VARCHAR(64) UNIQUE NOT NULL,
    shop_domain TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    nonce VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Table: oauth_nonces
-- Replay attack protection
-- ============================================
CREATE TABLE oauth_nonces (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    nonce VARCHAR(64) UNIQUE NOT NULL,
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for cleanup jobs
-- ============================================
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at) WHERE used_at IS NULL;
CREATE INDEX idx_oauth_nonces_expires ON oauth_nonces(expires_at);
CREATE INDEX idx_oauth_nonces_shop ON oauth_nonces(shop_id) WHERE shop_id IS NOT NULL;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE oauth_states IS 'Temporary CSRF tokens for OAuth - cleanup job deletes expired entries';
COMMENT ON TABLE oauth_nonces IS 'Replay protection nonces - cleanup job deletes expired entries';
COMMENT ON COLUMN oauth_states.state IS 'Random 64-char state token for CSRF protection';
COMMENT ON COLUMN oauth_states.expires_at IS 'TTL: typically 5-10 minutes';

-- NOTE: NO RLS on these tables - they contain pre-authentication data
