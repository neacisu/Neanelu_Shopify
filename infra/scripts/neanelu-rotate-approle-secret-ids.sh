#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# Auto-rotate OpenBao AppRole secret_id files for Neanelu
# =============================================================================
# Generates fresh secret_ids for all Neanelu AppRoles and writes them to disk.
# OpenBao agents re-read the secret_id file on next auth attempt, so no agent
# restart is needed — the agent will pick up the new file automatically.
#
# Designed to run via systemd timer (monthly) well before the 365-day TTL.
#
# Prerequisites:
#   - bao CLI available in PATH
#   - CerniqAPP .env with OPENBAO_ADDR + root token
#   - Write access to secrets directories
# =============================================================================

LOG_TAG="neanelu-rotate-secret-ids"
CERNIQ_ENV="/var/www/CerniqAPP/.env"
NEANELU_SECRETS="/var/www/Neanelu_Shopify/secrets"
LOCK_FILE="/run/neanelu-rotate-secret-ids.lock"

log()     { logger -t "$LOG_TAG" -p daemon.info  "$*"; echo "$(date -Iseconds) $*"; }
log_err() { logger -t "$LOG_TAG" -p daemon.err   "$*"; echo "$(date -Iseconds) ERROR: $*" >&2; }

cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT

if [[ -f "$LOCK_FILE" ]]; then
  log "Another rotation is already running, skipping."
  exit 0
fi
echo $$ > "$LOCK_FILE"

if [[ ! -f "$CERNIQ_ENV" ]]; then
  log_err "CerniqAPP env not found at $CERNIQ_ENV"
  exit 1
fi

BAO_ADDR=""
BAO_TOKEN=""
while IFS='=' read -r key value; do
  key="${key%%#*}"
  key="${key// /}"
  [[ -z "$key" ]] && continue
  case "$key" in
    OPENBAO_ADDR)                    BAO_ADDR="$value" ;;
    OPENBAO_ROOT_TOKEN_ACTIVE)       BAO_TOKEN="$value" ;;
    OPENBAO_ROOT_TOKEN_INITIAL)      [[ -z "$BAO_TOKEN" ]] && BAO_TOKEN="$value" ;;
  esac
done < "$CERNIQ_ENV"

if [[ -z "$BAO_ADDR" || -z "$BAO_TOKEN" ]]; then
  log_err "Missing OPENBAO_ADDR or root token in $CERNIQ_ENV"
  exit 1
fi

export BAO_ADDR BAO_TOKEN

ROLES=(
  "neanelu-dev-api:${NEANELU_SECRETS}/dev_api_secret_id"
  "neanelu-staging-api:${NEANELU_SECRETS}/staging_api_secret_id"
  "neanelu-infra:${NEANELU_SECRETS}/staging_infra_secret_id"
)

ERRORS=0

for entry in "${ROLES[@]}"; do
  role="${entry%%:*}"
  path="${entry#*:}"

  # Skip roles whose secret_id file doesn't exist (role not deployed on this host)
  if [[ ! -f "$path" ]]; then
    log "Skipping $role — file $path does not exist on this host"
    continue
  fi

  log "Rotating secret_id for role=$role → $path"

  new_sid=$(bao write -f -field=secret_id "auth/approle/role/${role}/secret-id" 2>&1) || {
    log_err "Failed to generate secret_id for $role: $new_sid"
    ERRORS=$((ERRORS + 1))
    continue
  }

  if [[ -z "$new_sid" || ${#new_sid} -lt 30 ]]; then
    log_err "Invalid secret_id for $role (length=${#new_sid})"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  printf '%s' "$new_sid" > "$path"
  chmod 0400 "$path"
  chown 1000:1000 "$path"
  log "Rotated secret_id for role=$role successfully (ttl=365d)"
done

if (( ERRORS > 0 )); then
  log_err "Rotation completed with $ERRORS error(s)"
  exit 1
fi

log "All secret_ids rotated successfully"
