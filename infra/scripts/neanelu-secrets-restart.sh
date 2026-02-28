#!/usr/bin/env bash
set -euo pipefail
# DEPRECATED: replaced by app-level credential-watcher.ts hot-reload.
# =============================================================================
# Neanelu Secrets Restart
# =============================================================================
# Triggered by systemd .path unit when OpenBao agent rotates credentials.
# Recreates application containers so they pick up the new env_file values.
#
# Usage: neanelu-secrets-restart.sh <env>
#   env: "dev" | "staging" | "prod"
# =============================================================================

NEANELU_ENV="${1:-}"
COMPOSE_DIR="/var/www/Neanelu_Shopify"
LOG_TAG="neanelu-secrets-restart"
LOCK_FILE="/run/neanelu-secrets-restart-${NEANELU_ENV}.lock"
COOLDOWN_SECONDS=30

log() { logger -t "$LOG_TAG" -p daemon.info "$*"; echo "$(date -Iseconds) $*"; }
log_err() { logger -t "$LOG_TAG" -p daemon.err "$*"; echo "$(date -Iseconds) ERROR: $*" >&2; }

if [[ -z "$NEANELU_ENV" ]]; then
  log_err "Usage: $0 <dev|staging|prod>"
  exit 1
fi

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "Another restart for env=$NEANELU_ENV is already running, skipping."
  exit 0
fi

if [[ -f "${LOCK_FILE}.last" ]]; then
  last_run=$(cat "${LOCK_FILE}.last" 2>/dev/null || echo 0)
  now=$(date +%s)
  elapsed=$(( now - last_run ))
  if (( elapsed < COOLDOWN_SECONDS )); then
    log "Cooldown active for env=$NEANELU_ENV (${elapsed}s < ${COOLDOWN_SECONDS}s), skipping."
    exit 0
  fi
fi

date +%s > "${LOCK_FILE}.last"

case "$NEANELU_ENV" in
  dev)
    COMPOSE_FILE="docker-compose.staging.yml"
    COMPOSE_OVERRIDE="-f docker-compose.dev-local.yml"
    COMPOSE_ARGS="--profile dev"
    SERVICES="backend-worker-dev web-admin-dev"
    ;;
  staging)
    COMPOSE_FILE="docker-compose.staging.yml"
    COMPOSE_OVERRIDE=""
    COMPOSE_ARGS=""
    SERVICES="backend-worker web-admin"
    ;;
  prod)
    COMPOSE_FILE="docker-compose.prod.yml"
    COMPOSE_OVERRIDE=""
    COMPOSE_ARGS=""
    SERVICES="backend-worker web-admin"
    ;;
  *)
    log_err "Unknown env: $NEANELU_ENV"
    exit 1
    ;;
esac

log "Credentials rotated for env=$NEANELU_ENV — recreating containers: $SERVICES"

cd "$COMPOSE_DIR"
# shellcheck disable=SC2086
if docker compose -f "$COMPOSE_FILE" $COMPOSE_OVERRIDE $COMPOSE_ARGS up -d $SERVICES 2>&1 | while read -r line; do log "$line"; done; then
  log "Containers recreated successfully for env=$NEANELU_ENV"
else
  log_err "Failed to recreate containers for env=$NEANELU_ENV (exit=$?)"
  exit 1
fi
