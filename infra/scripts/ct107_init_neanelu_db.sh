#!/usr/bin/env bash
set -euo pipefail

# CT107 (postgres-main) - init Neanelu DBs + roles + extensions.
#
# Safety and principles:
# - No secrets in repo: passwords are generated on CT107 at runtime.
# - Idempotent where possible: re-running should not break existing DBs.
# - Does NOT touch pg_hba.conf hardening (that is phase00-004B).
#
# Usage (run on CT107 as root):
#   sudo bash ct107_init_neanelu_db.sh
#
# Output:
# - writes initial credentials to a root-only file:
#   /root/neanelu_ct107_initial_db_passwords_<timestamp>.txt
#
# After phase00-005 (OpenBao), rotate these credentials and delete the file.

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing binary: $1" >&2; exit 2; }; }
need_bin sudo
need_bin psql
need_bin openssl

ts="$(date -u +%Y%m%dT%H%M%SZ)"
secrets_file="/root/neanelu_ct107_initial_db_passwords_${ts}.txt"

app_pw="$(openssl rand -base64 48)"
vault_pw="$(openssl rand -base64 48)"

umask 077
cat > "${secrets_file}" <<EOF
NEANELU_APP_USER=neanelu_app
NEANELU_APP_PASSWORD=${app_pw}

NEANELU_VAULT_USER=neanelu_vault
NEANELU_VAULT_PASSWORD=${vault_pw}

NEANELU_DB_PROD=neanelu_shopify
NEANELU_DB_STAGING=neanelu_shopify_staging
NEANELU_DB_DEV=neanelu_shopify_dev
EOF

echo "Wrote initial credentials to: ${secrets_file}"
echo "NOTE: rotate into OpenBao at phase00-005, then delete this file."

sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<SQL
-- Note: psql variable substitution (:\<var\>) is fragile in non-interactive contexts,
-- especially when embedded in DO blocks or through multiple shell layers.
-- We keep this section minimal and use separate bash-side conditional commands below.
SELECT 1;
SQL

echo "--- create roles if missing"
if ! sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='neanelu_vault'" | grep -q "^1$"; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE neanelu_vault LOGIN PASSWORD '${vault_pw}';"
fi
if ! sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='neanelu_app'" | grep -q "^1$"; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE neanelu_app LOGIN PASSWORD '${app_pw}';"
fi

echo "--- create databases if missing"
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='neanelu_shopify'" | grep -q "^1$"; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE neanelu_shopify OWNER neanelu_app;"
fi
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='neanelu_shopify_staging'" | grep -q "^1$"; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE neanelu_shopify_staging OWNER neanelu_app;"
fi
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='neanelu_shopify_dev'" | grep -q "^1$"; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE neanelu_shopify_dev OWNER neanelu_app;"
fi

echo "--- OpenBao DB engine prerequisites (Neanelu-scoped only)"
# OpenBao database secrets engine must be able to create roles and assign membership into neanelu_app.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "ALTER ROLE neanelu_vault CREATEROLE;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "GRANT neanelu_app TO neanelu_vault WITH ADMIN OPTION;"

for db in neanelu_shopify neanelu_shopify_staging neanelu_shopify_dev; do
  echo "--- extensions/grants on ${db}"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS citext;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS btree_gin;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${db} TO neanelu_app;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "GRANT ALL ON SCHEMA public TO neanelu_app;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO neanelu_app;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_app;"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_app;"
done

echo "--- minimal verification"
sudo -u postgres psql -Atc "select datname from pg_database where datname like 'neanelu_%' order by 1;"
sudo -u postgres psql -Atc "select rolname from pg_roles where rolname in ('neanelu_app','neanelu_vault') order by 1;"
sudo -u postgres psql -d neanelu_shopify -Atc "select extname from pg_extension where extname in ('vector','pg_stat_statements','citext') order by 1;"

echo "--- done"

# Keep last few secrets files only (best-effort cleanup).
ls -1t /root/neanelu_ct107_initial_db_passwords_*.txt 2>/dev/null | tail -n +6 | xargs -r rm -f || true

