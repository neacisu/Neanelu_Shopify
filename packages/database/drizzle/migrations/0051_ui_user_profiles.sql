-- Migration: 0051_ui_user_profiles.sql
-- Purpose: DB-backed UI user profile (PR-028 multi-shop UX)
-- Notes:
-- - This is NOT a Shopify staff user table.
-- - It stores lightweight UI preferences (e.g., last/active shop domain) for the web-admin.
-- - No RLS: preferences are not tenant-scoped and contain no secrets.

CREATE TABLE IF NOT EXISTS ui_user_profiles (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  active_shop_domain TEXT,
  last_shop_domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep timestamps consistent with other tables.
CREATE TRIGGER trg_ui_user_profiles_updated_at
  BEFORE UPDATE ON ui_user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_ui_user_profiles_active_shop_domain
  ON ui_user_profiles (active_shop_domain);
