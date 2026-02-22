#!/usr/bin/env bash
set -euo pipefail

# CT107 (postgres-main) restore helper for Neanelu.
#
# Safety:
# - Requires explicit CONFIRM_RESTORE=YES
# - Intended to be executed on CT107 as root; uses `sudo -u postgres`
# - Restores into an existing database (created in phase00-004)
#
# Usage (on CT107):
#   CONFIRM_RESTORE=YES DB=neanelu_shopify_staging DUMP=/var/backups/neanelu/postgres/<run>/neanelu_shopify.dump \
#     sudo bash infra/scripts/ct107_restore_postgres_neanelu.sh
#
# Env vars:
#   DB   (required) target database name
#   DUMP (required) path to .dump (pg_dump -Fc)
#   CONFIRM_RESTORE must be YES

CONFIRM_RESTORE="${CONFIRM_RESTORE:-NO}"
DB="${DB:-}"
DUMP="${DUMP:-}"

if [[ "${CONFIRM_RESTORE}" != "YES" ]]; then
  echo "ERROR: refusing to restore. Set CONFIRM_RESTORE=YES" >&2
  exit 2
fi
if [[ -z "${DB}" || -z "${DUMP}" ]]; then
  echo "ERROR: DB and DUMP are required" >&2
  exit 2
fi
if [[ ! -f "${DUMP}" ]]; then
  echo "ERROR: dump file not found: ${DUMP}" >&2
  exit 2
fi

command -v sudo >/dev/null
command -v pg_restore >/dev/null
command -v psql >/dev/null

echo "--- precheck database exists: ${DB}"
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='${DB}'" | grep -q "^1$"; then
  echo "ERROR: target database does not exist: ${DB}" >&2
  echo "Hint: run phase00-004 (init-ct107-neanelu.sql) first." >&2
  exit 3
fi

echo "--- sanity list dump"
sudo -u postgres pg_restore --list "${DUMP}" >/dev/null

echo "--- restore (clean + if-exists)"
sudo -u postgres pg_restore --clean --if-exists --no-owner --no-acl -d "${DB}" "${DUMP}"

echo "--- vacuum analyze (best-effort)"
sudo -u postgres psql -d "${DB}" -c "VACUUM (ANALYZE);" >/dev/null || true

echo "--- restore done"

