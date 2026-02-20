#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# Deploy Neanelu Secrets Watcher
# =============================================================================
# Installs the OpenBao credential rotation watcher on the current host.
#
# Usage: deploy-secrets-watcher.sh <env>
#   env: "dev" | "staging" | "prod"
# =============================================================================

NEANELU_ENV="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "$NEANELU_ENV" ]]; then
  echo "Usage: $0 <dev|staging|prod>"
  exit 1
fi

echo "[1/5] Installing restart script..."
install -m 0755 "$REPO_ROOT/infra/scripts/neanelu-secrets-restart.sh" \
  /opt/neanelu/infra/scripts/neanelu-secrets-restart.sh

echo "[2/5] Installing systemd service unit..."
install -m 0644 "$REPO_ROOT/infra/systemd/neanelu-secrets-restart@.service" \
  /etc/systemd/system/neanelu-secrets-restart@.service

echo "[3/5] Installing systemd path unit for env=$NEANELU_ENV..."
install -m 0644 "$REPO_ROOT/infra/systemd/neanelu-secrets-restart@${NEANELU_ENV}.path" \
  /etc/systemd/system/neanelu-secrets-restart@${NEANELU_ENV}.path

echo "[4/5] Syncing OpenBao agent configs..."
cp "$REPO_ROOT/infra/config/openbao/agent-api.hcl" /opt/neanelu/infra/config/openbao/agent-api.hcl
cp "$REPO_ROOT/infra/config/openbao/agent-workers.hcl" /opt/neanelu/infra/config/openbao/agent-workers.hcl

echo "[5/5] Enabling and starting systemd units..."
systemctl daemon-reload
systemctl enable --now "neanelu-secrets-restart@${NEANELU_ENV}.path"

echo ""
echo "Deployed successfully. Status:"
systemctl status "neanelu-secrets-restart@${NEANELU_ENV}.path" --no-pager || true
