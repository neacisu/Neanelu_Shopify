-- CT107 (postgres-main) - Neanelu Shopify
-- Scop: creare DB-uri prod+staging + users + extensii (aditiv, idempotent unde e posibil).
--
-- Rulare: pe CT107 ca user `postgres` (psql superuser).
-- Nota: parolele initiale NU trebuie hardcodate aici in productie; se pot seta manual o data,
-- apoi gestionate prin OpenBao rotate. Acest fisier ramane “template” pentru executie controlata.

-- === Users (daca nu exista) ===
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neanelu_vault') THEN
    CREATE USER neanelu_vault WITH PASSWORD 'INITIAL_STRONG_PASSWORD_CHANGE_ME';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neanelu_app') THEN
    CREATE USER neanelu_app WITH PASSWORD 'INITIAL_STRONG_PASSWORD_CHANGE_ME';
  END IF;
END $$;

-- === Databases ===
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'neanelu_shopify') THEN
    CREATE DATABASE neanelu_shopify OWNER neanelu_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'neanelu_shopify_staging') THEN
    CREATE DATABASE neanelu_shopify_staging OWNER neanelu_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'neanelu_shopify_dev') THEN
    CREATE DATABASE neanelu_shopify_dev OWNER neanelu_app;
  END IF;
END $$;

-- neanelu_vault: user folosit de OpenBao DB engine pentru credite dinamice (creds).
-- Minim necesar:
-- - CREATEROLE (ca sa poata crea useri dinamici)
-- - ADMIN OPTION pe rolul de grup neanelu_app (ca sa poata adauga userii dinamici in rol)
ALTER USER neanelu_vault CREATEROLE;
GRANT neanelu_app TO neanelu_vault WITH ADMIN OPTION;

-- === Prod DB extensions/grants ===
\connect neanelu_shopify

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT ALL PRIVILEGES ON DATABASE neanelu_shopify TO neanelu_app;
GRANT ALL ON SCHEMA public TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_app;

-- === Staging DB extensions/grants ===
\connect neanelu_shopify_staging

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT ALL PRIVILEGES ON DATABASE neanelu_shopify_staging TO neanelu_app;
GRANT ALL ON SCHEMA public TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_app;

-- === Dev DB extensions/grants ===
\connect neanelu_shopify_dev

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT ALL PRIVILEGES ON DATABASE neanelu_shopify_dev TO neanelu_app;
GRANT ALL ON SCHEMA public TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_app;

