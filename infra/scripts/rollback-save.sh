#!/usr/bin/env bash
# =============================================================================
# Neanelu Shopify - Save rollback images on target host
# =============================================================================
# Usage:
#   rollback-save.sh <compose-file>
#
# Example:
#   sudo bash /opt/neanelu/infra/scripts/rollback-save.sh docker-compose.staging.yml
# =============================================================================

set -euo pipefail

COMPOSE_FILE="${1:-}"
ROLLBACK_DIR="/opt/neanelu/rollback"
MAX_SETS=2

if [[ -z "${COMPOSE_FILE}" ]]; then
  echo "Usage: $0 <compose-file>" >&2
  exit 1
fi

mkdir -p "${ROLLBACK_DIR}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

for svc in backend-worker web-admin; do
  cid="$(docker compose -f "${COMPOSE_FILE}" ps -q "${svc}" 2>/dev/null || true)"
  if [[ -z "${cid}" ]]; then
    echo "rollback_save skip service=${svc} reason=not_running"
    continue
  fi

  image_ref="$(docker inspect --format='{{.Config.Image}}' "${cid}")"
  archive="${ROLLBACK_DIR}/${svc}-${timestamp}.tar.gz"
  tag_file="${ROLLBACK_DIR}/${svc}-${timestamp}.tag"

  echo "rollback_save service=${svc} image=${image_ref} archive=${archive}"
  docker save "${image_ref}" | gzip > "${archive}"
  printf '%s\n' "${image_ref}" > "${tag_file}"
done

# Keep only the latest MAX_SETS archives/tag files per service.
for svc in backend-worker web-admin; do
  mapfile -t old_archives < <(ls -1t "${ROLLBACK_DIR}/${svc}-"*.tar.gz 2>/dev/null | awk "NR>${MAX_SETS}")
  for file in "${old_archives[@]}"; do
    rm -f "${file}"
  done

  mapfile -t old_tags < <(ls -1t "${ROLLBACK_DIR}/${svc}-"*.tag 2>/dev/null | awk "NR>${MAX_SETS}")
  for file in "${old_tags[@]}"; do
    rm -f "${file}"
  done
done

echo "rollback_save done max_sets=${MAX_SETS}"
