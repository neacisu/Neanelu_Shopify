#!/usr/bin/env bash
set -euo pipefail

# H.3: Cleanup helper for LOCAL dev-only volumes.
# This is intentionally conservative and only targets known Neanelu volumes.
#
# Usage:
#   ./infra/scripts/cleanup-local-volumes.sh          # dry-run
#   ./infra/scripts/cleanup-local-volumes.sh --apply  # actually remove

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--apply]" >&2
  exit 2
fi

VOLUMES=(
  "neanelu_postgres_data"
  "neanelu_redis_data"
  "neanelu_traefik_letsencrypt"
)

echo "[info] mode=$([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY_RUN)"
echo "[info] checking docker availability..."
docker version >/dev/null

echo "[info] candidate volumes:"
for v in "${VOLUMES[@]}"; do
  if docker volume inspect "$v" >/dev/null 2>&1; then
    echo "  - present: $v"
  else
    echo "  - missing: $v"
  fi
done

if [[ $APPLY -ne 1 ]]; then
  echo "[info] dry-run only. Re-run with --apply to remove volumes."
  exit 0
fi

echo "[warn] stopping local dev compose (best-effort)..."
if [[ -f "docker-compose.yml" ]]; then
  docker compose down >/dev/null 2>&1 || true
fi

echo "[warn] removing volumes..."
for v in "${VOLUMES[@]}"; do
  if docker volume inspect "$v" >/dev/null 2>&1; then
    docker volume rm "$v"
  fi
done

echo "[ok] cleanup complete"

