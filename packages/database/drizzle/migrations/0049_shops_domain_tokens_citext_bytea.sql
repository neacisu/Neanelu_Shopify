-- Migration: 0049_shops_domain_tokens_citext_bytea.sql
-- Align shops.shopify_domain and token columns to industry-standard types:
-- - shopify_domain: citext
-- - access_token_* and webhook_secret: bytea

-- Ensure citext extension exists (CI installs it, but this makes the migration self-contained)
CREATE EXTENSION IF NOT EXISTS citext;

-- shopify_domain is referenced by mv_shop_summary; drop and recreate to allow type change.
DROP MATERIALIZED VIEW IF EXISTS mv_shop_summary;

-- shopify_domain should be CITEXT
ALTER TABLE shops
  ALTER COLUMN shopify_domain TYPE citext
  USING shopify_domain::citext;

-- Helper to decode legacy text token storage into bytea.
-- Accepts:
-- - bytea hex literal string: \xDEADBEEF
-- - raw hex string: DEADBEEF
-- - base64 string
CREATE OR REPLACE FUNCTION _text_to_bytea_strict(val text)
RETURNS bytea
LANGUAGE plpgsql
AS $$
BEGIN
  IF val IS NULL THEN
    RETURN NULL;
  END IF;

  IF val ~ '^\\x[0-9A-Fa-f]+$' THEN
    RETURN decode(substring(val from 3), 'hex');
  END IF;

  IF val ~ '^[0-9A-Fa-f]+$' AND (length(val) % 2) = 0 THEN
    RETURN decode(val, 'hex');
  END IF;

  IF val ~ '^[A-Za-z0-9+/]+={0,2}$' AND (length(val) % 4) = 0 THEN
    RETURN decode(val, 'base64');
  END IF;

  RAISE EXCEPTION
    'Cannot decode token value to bytea (expected \\xHEX, HEX, or base64). Prefix=%',
    left(val, 32);
END;
$$;

-- Token columns should be BYTEA
ALTER TABLE shops
  ALTER COLUMN access_token_ciphertext TYPE bytea
  USING _text_to_bytea_strict(access_token_ciphertext);

ALTER TABLE shops
  ALTER COLUMN access_token_iv TYPE bytea
  USING _text_to_bytea_strict(access_token_iv);

ALTER TABLE shops
  ALTER COLUMN access_token_tag TYPE bytea
  USING _text_to_bytea_strict(access_token_tag);

ALTER TABLE shops
  ALTER COLUMN webhook_secret TYPE bytea
  USING _text_to_bytea_strict(webhook_secret);

DROP FUNCTION _text_to_bytea_strict(text);

-- Recreate MV after shopify_domain type change
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_shop_summary AS
SELECT 
  s.id as shop_id,
  s.shopify_domain,
  COUNT(DISTINCT sp.id) as total_products,
  COUNT(DISTINCT sv.id) as total_variants,
  COUNT(DISTINCT sc.id) as total_collections,
  COUNT(DISTINCT so.id) as total_orders,
  COALESCE(SUM(so.total_price), 0) as total_revenue,
  COUNT(DISTINCT cust.id) as total_customers,
  MAX(sp.synced_at) as last_product_sync,
  MAX(so.synced_at) as last_order_sync,
  NOW() as refreshed_at
FROM shops s
LEFT JOIN shopify_products sp ON sp.shop_id = s.id AND sp.status = 'ACTIVE'
LEFT JOIN shopify_variants sv ON sv.shop_id = s.id
LEFT JOIN shopify_collections sc ON sc.shop_id = s.id
LEFT JOIN shopify_orders so ON so.shop_id = s.id
LEFT JOIN shopify_customers cust ON cust.shop_id = s.id
GROUP BY s.id, s.shopify_domain;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_shop_summary_pk ON mv_shop_summary(shop_id);

COMMENT ON MATERIALIZED VIEW mv_shop_summary IS 'Dashboard KPIs per shop. Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_summary;';

-- Align index naming with docs/tests: idx_shops_domain
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'shops_shopify_domain_unique'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_shops_domain'
  ) THEN
    EXECUTE 'ALTER INDEX shops_shopify_domain_unique RENAME TO idx_shops_domain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'shops'
      AND c.conname = 'shops_shopify_domain_unique'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'shops'
      AND c.conname = 'idx_shops_domain'
  ) THEN
    EXECUTE 'ALTER TABLE shops RENAME CONSTRAINT shops_shopify_domain_unique TO idx_shops_domain';
  END IF;
END $$;
