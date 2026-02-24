#!/bin/sh
set -e

SECRETS_FILE="${NEANELU_SECRETS:-/run/neanelu-dev/runtime-secrets/api/neanelu-api.env}"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "Error: Secrets not found at $SECRETS_FILE" >&2
  echo "Ensure OpenBao agent is running (docker ps | grep openbao)." >&2
  exit 1
fi

set -a
. "$SECRETS_FILE"
DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"
set +a

exec "$@"
