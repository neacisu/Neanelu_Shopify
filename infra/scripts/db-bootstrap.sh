#!/usr/bin/env bash
set -euo pipefail

# Fast dev bootstrap helper (Plan FAZA F.7).
# NOTE: This script is meant for local/dev usage only.
# In staging/prod, DB provisioning is handled centrally (CT107 + OpenBao + CI/CD).

req() {
  local k="$1"
  if [[ -z "${!k:-}" ]]; then
    echo "ERROR: missing required env var: ${k}" >&2
    exit 2
  fi
}

req POSTGRES_SUPERUSER_PASSWORD
req POSTGRES_USER
req DB_HOST
req DB_PORT
req DB_NAME

SUPERUSER="${POSTGRES_SUPERUSER:-postgres}"

echo "[db-bootstrap] target=${DB_HOST}:${DB_PORT}/${DB_NAME} owner=${POSTGRES_USER}"

export PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}"

# Create DB + owner role if missing (idempotent).
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${SUPERUSER}" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
    CREATE ROLE ${POSTGRES_USER} WITH LOGIN;
  END IF;
END \$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}') THEN
    CREATE DATABASE ${DB_NAME} OWNER ${POSTGRES_USER};
  END IF;
END \$\$;
SQL

echo "[db-bootstrap] ok"

