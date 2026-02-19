-- CT107 (postgres-main) - Neanelu PgBouncer auth_query support
-- Scop: rol dedicat pentru PgBouncer + functie SECURITY DEFINER care returneaza SCRAM verifier pentru userii DB.
--
-- Rulare: pe CT107 ca user `postgres`, pe ambele DB-uri: neanelu_shopify si neanelu_shopify_staging.
-- Acest script este aditiv si poate fi rulat repetat (idempotent).

-- === Shared role for PgBouncer auth_query ===
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neanelu_pgbouncer_auth') THEN
    CREATE ROLE neanelu_pgbouncer_auth WITH LOGIN PASSWORD 'MANAGED_BY_OPENBAO';
  END IF;
END $$;

-- Prod DB
\connect neanelu_shopify

CREATE OR REPLACE FUNCTION public.neanelu_pgbouncer_get_auth(p_usename TEXT)
RETURNS TABLE (usename TEXT, passwd TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT rolname::text AS usename, rolpassword::text AS passwd
  FROM pg_authid
  WHERE rolname = p_usename
$$;

REVOKE ALL ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) TO neanelu_pgbouncer_auth;

-- Staging DB
\connect neanelu_shopify_staging

CREATE OR REPLACE FUNCTION public.neanelu_pgbouncer_get_auth(p_usename TEXT)
RETURNS TABLE (usename TEXT, passwd TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT rolname::text AS usename, rolpassword::text AS passwd
  FROM pg_authid
  WHERE rolname = p_usename
$$;

REVOKE ALL ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) TO neanelu_pgbouncer_auth;

