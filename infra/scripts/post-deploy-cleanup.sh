#!/usr/bin/env bash
# =============================================================================
# Neanelu Shopify - Post deploy Docker cleanup
# =============================================================================
# Usage:
#   post-deploy-cleanup.sh
#
# Example:
#   sudo bash /opt/neanelu/infra/scripts/post-deploy-cleanup.sh
# =============================================================================

set -euo pipefail

echo "cleanup step=image_prune"
docker image prune -f

echo "cleanup step=container_prune"
docker container prune -f

echo "cleanup step=disk_usage"
docker system df
