-- Migration: 0052_ui_user_profiles_recent_shops.sql
-- Purpose: Store recent shop domains for non-embedded multi-shop UX (PR-028 completion)

ALTER TABLE ui_user_profiles
  ADD COLUMN IF NOT EXISTS recent_shop_domains TEXT[] NOT NULL DEFAULT '{}';
