-- Migration: 0017_alter_shops.sql
-- PR-011: F2.2.11 - Additional Columns for shops
-- Description: Add missing columns for OAuth, rate limiting, and plan limits
-- 
-- CONFORM: Database_Schema_Complete.md v2.6 - Module A: System Core

-- ============================================
-- Add new columns to shops
-- ============================================
ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_owner_email TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS rate_limit_bucket INTEGER DEFAULT 1000;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS last_api_call_at TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_limits JSONB DEFAULT '{}';

-- ============================================
-- CHECK constraint for plan_tier
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_plan_tier'
    ) THEN
        ALTER TABLE shops ADD CONSTRAINT chk_plan_tier 
            CHECK (plan_tier IN ('basic', 'pro', 'enterprise'));
    END IF;
END $$;

-- ============================================
-- Partial unique index for active domains
-- Only one active shop per domain (uninstalled_at IS NULL)
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_active_domain 
    ON shops(shopify_domain) WHERE uninstalled_at IS NULL;

-- ============================================
-- Index on owner email for support queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_shops_owner_email 
    ON shops(shop_owner_email) WHERE shop_owner_email IS NOT NULL;

-- ============================================
-- Comments
-- ============================================
COMMENT ON COLUMN shops.shop_owner_email IS 'Shop owner email from Shopify for support communication';
COMMENT ON COLUMN shops.rate_limit_bucket IS 'Current token bucket value for rate limiting';
COMMENT ON COLUMN shops.last_api_call_at IS 'Timestamp of last Shopify API call for this shop';
COMMENT ON COLUMN shops.plan_limits IS 'Plan-specific limits: {maxProducts, maxOrders, aiCallsPerMonth}';
