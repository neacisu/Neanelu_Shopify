#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/Neanelu_Shopify/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/www/Neanelu_Shopify/infra/backups/local}"
CONTAINER_NAME="${CONTAINER_NAME:-neanelu_postgres}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

: "${POSTGRES_USER:?missing POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?missing POSTGRES_PASSWORD}"
: "${POSTGRES_DB:?missing POSTGRES_DB}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR}/${POSTGRES_DB}_${ts}.dump"

echo "dump_db=${POSTGRES_DB} out=${out}"

docker exec -e "PGPASSWORD=${POSTGRES_PASSWORD}" "$CONTAINER_NAME" \
  pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" >"$out"

(
  cd "$BACKUP_DIR"
  base="$(basename "$out")"
  sha256sum "$base" >"${base}.sha256"
  ls -lah "$base" "${base}.sha256"
)

