#!/usr/bin/env bash
set -euo pipefail
# Grant full permissions on a CI clone database to a specified user.
# Run as: sudo -u postgres ct107_ci_grant_db.sh --db <db_name> --user <username>
#
# Safety: only operates on databases matching the CI clone naming pattern
# (neanelu_shopify_*_ci_*) to prevent accidental grants on source DBs.

DB_NAME=""
GRANT_USER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)    DB_NAME="$2";    shift 2 ;;
    --user)  GRANT_USER="$2"; shift 2 ;;
    *)       echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${DB_NAME}" ]] || [[ -z "${GRANT_USER}" ]]; then
  echo "Usage: $0 --db <db_name> --user <username>" >&2
  exit 1
fi

if ! [[ "${DB_NAME}" =~ ^neanelu_shopify_.*_ci_ ]]; then
  echo "ERROR: db '${DB_NAME}' does not match CI clone pattern (neanelu_shopify_*_ci_*). Refusing." >&2
  exit 2
fi

if ! psql -Atc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q '^1$'; then
  echo "ERROR: database '${DB_NAME}' does not exist" >&2
  exit 3
fi

echo "grant_all db=${DB_NAME} user=${GRANT_USER}"

psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "
  GRANT ALL PRIVILEGES ON DATABASE \"${DB_NAME}\" TO \"${GRANT_USER}\";

  -- public schema
  GRANT ALL ON SCHEMA public TO \"${GRANT_USER}\";
  GRANT ALL ON ALL TABLES IN SCHEMA public TO \"${GRANT_USER}\";
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO \"${GRANT_USER}\";
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"${GRANT_USER}\";
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \"${GRANT_USER}\";

  -- drizzle schema (migration tracking)
  CREATE SCHEMA IF NOT EXISTS drizzle;
  GRANT ALL ON SCHEMA drizzle TO \"${GRANT_USER}\";
  GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO \"${GRANT_USER}\";
  GRANT ALL ON ALL SEQUENCES IN SCHEMA drizzle TO \"${GRANT_USER}\";
  ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON TABLES TO \"${GRANT_USER}\";
  ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON SEQUENCES TO \"${GRANT_USER}\";
"

echo "transfer_ownership db=${DB_NAME} user=${GRANT_USER}"

psql -At -d "${DB_NAME}" -c "
  SELECT format('ALTER TABLE %I.%I OWNER TO %I;', schemaname, tablename, '${GRANT_USER}')
  FROM pg_tables WHERE schemaname IN ('public','drizzle');
  SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I;', schemaname, sequencename, '${GRANT_USER}')
  FROM pg_sequences WHERE schemaname IN ('public','drizzle');
  SELECT format('ALTER VIEW %I.%I OWNER TO %I;', schemaname, viewname, '${GRANT_USER}')
  FROM pg_views WHERE schemaname IN ('public','drizzle');
  SELECT format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I;', schemaname, matviewname, '${GRANT_USER}')
  FROM pg_matviews WHERE schemaname IN ('public','drizzle');
" | psql -v ON_ERROR_STOP=1 -d "${DB_NAME}"

echo "grant_ok db=${DB_NAME} user=${GRANT_USER}"
