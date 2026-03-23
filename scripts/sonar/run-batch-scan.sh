#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${SONAR_BATCH_OUTPUT_DIR:-$ROOT_DIR/temp/sonar-batches}"
IMAGE="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:latest}"
HOST_URL="${SONAR_HOST_URL:-http://localhost:9000}"
PROJECT_KEY_PREFIX="${SONAR_PROJECT_KEY_PREFIX:-neanelu-shopify-batch}"
PROJECT_NAME_PREFIX="${SONAR_PROJECT_NAME_PREFIX:-Neanelu Shopify Batch}"
SLEEP_SECONDS="${SONAR_BATCH_SLEEP_SECONDS:-8}"
NICE_LEVEL="${SONAR_BATCH_NICE:-15}"
IONICE_LEVEL="${SONAR_BATCH_IONICE:-7}"

DEFAULT_EXCLUSIONS='**/node_modules/**,**/dist/**,**/build/**,**/.react-router/**,**/coverage/**,**/*.min.js,**/pnpm-lock.yaml,**/.cache/**,**/temp/**,**/temp-token/**,**/secrets/**'
SONAR_EXCLUSIONS="${SONAR_EXCLUSIONS:-$DEFAULT_EXCLUSIONS}"

mkdir -p "$OUTPUT_DIR"

declare -a BATCH_NAMES=(
  'web-admin-components'
  'web-admin-shell'
  'backend-processors'
  'backend-shell'
  'data-core'
  'domain-pim'
  'runtime-services'
)

declare -a BATCH_SOURCES=(
  'apps/web-admin/app/components'
  'apps/web-admin/app/routes,apps/web-admin/app/hooks,apps/web-admin/app/lib,apps/web-admin/app/contexts,apps/web-admin/app/shopify,apps/web-admin/app/types,apps/web-admin/app/utils,apps/web-admin/app/root.tsx,apps/web-admin/app/entry.client.tsx,apps/web-admin/app/routes.ts,apps/web-admin/app/globals.css,apps/web-admin/app/vite-env.d.ts'
  'apps/backend-worker/src/processors'
  'apps/backend-worker/src/routes,apps/backend-worker/src/services,apps/backend-worker/src/auth,apps/backend-worker/src/queue,apps/backend-worker/src/runtime,apps/backend-worker/src/shopify,apps/backend-worker/src/http,apps/backend-worker/src/otel,apps/backend-worker/src/types,apps/backend-worker/src/scripts,apps/backend-worker/src/main.ts'
  'packages/database,packages/config,packages/logger,scripts,docker,package.json,eslint.config.js,oauth-callback-server.ts,tsconfig.json,tsconfig.base.json,tsconfig.eslint.json,docker-compose.yml,docker-compose.dev.yml,docker-compose.dev-local.yml,docker-compose.prod.yml,docker-compose.staging.yml,docker-compose.vector-agent.yml'
  'packages/pim,packages/types,packages/validation,packages/shopify-client'
  'packages/queue-manager,packages/scraper,packages/ai-engine'
)

declare -a RESULTS=()

build_auth_args() {
  local -a args=()

  if [[ -n "${SONAR_TOKEN:-}" ]]; then
    args+=("-Dsonar.token=${SONAR_TOKEN}")
  elif [[ -n "${SONAR_LOGIN:-}" && -n "${SONAR_PASSWORD:-}" ]]; then
    args+=("-Dsonar.login=${SONAR_LOGIN}" "-Dsonar.password=${SONAR_PASSWORD}")
  else
    args+=("-Dsonar.login=admin" "-Dsonar.password=admin")
  fi

  printf '%s\n' "${args[@]}"
}

run_scanner() {
  local batch_name="$1"
  local batch_index="$2"
  local batch_sources="$3"
  local log_file="$OUTPUT_DIR/${batch_index}-${batch_name}.log"
  local project_key="${PROJECT_KEY_PREFIX}-${batch_index}"
  local project_name="${PROJECT_NAME_PREFIX} ${batch_index}"
  local -a auth_args=()
  local -a base_cmd=(docker run --rm --network host -v "$ROOT_DIR:/usr/src" -w /usr/src "$IMAGE" sonar-scanner)
  local -a scanner_args=(
    "-Dsonar.projectKey=${project_key}"
    "-Dsonar.projectName=${project_name}"
    "-Dsonar.sources=${batch_sources}"
    "-Dsonar.exclusions=${SONAR_EXCLUSIONS}"
    "-Dsonar.host.url=${HOST_URL}"
    '-Dsonar.sourceEncoding=UTF-8'
  )
  local exit_code=0

  mapfile -t auth_args < <(build_auth_args)

  {
    printf '[%s] Starting batch %s (%s)\n' "$(date '+%F %T')" "$batch_index" "$batch_name"
    printf '[%s] Sources: %s\n' "$(date '+%F %T')" "$batch_sources"
  } | tee "$log_file"

  if command -v ionice >/dev/null 2>&1; then
    ionice -c2 -n"$IONICE_LEVEL" nice -n "$NICE_LEVEL" "${base_cmd[@]}" "${scanner_args[@]}" "${auth_args[@]}" >>"$log_file" 2>&1 || exit_code=$?
  else
    nice -n "$NICE_LEVEL" "${base_cmd[@]}" "${scanner_args[@]}" "${auth_args[@]}" >>"$log_file" 2>&1 || exit_code=$?
  fi

  if [[ "$exit_code" -eq 0 ]]; then
    RESULTS+=("${batch_index}|${batch_name}|ok|${log_file}")
    printf '[%s] Batch %s (%s) completed successfully\n' "$(date '+%F %T')" "$batch_index" "$batch_name" | tee -a "$log_file"
  else
    RESULTS+=("${batch_index}|${batch_name}|failed(${exit_code})|${log_file}")
    printf '[%s] Batch %s (%s) failed with exit code %s\n' "$(date '+%F %T')" "$batch_index" "$batch_name" "$exit_code" | tee -a "$log_file"
  fi

  return 0
}

main() {
  local total_batches="${#BATCH_NAMES[@]}"
  local index=0

  printf 'Writing batch logs to %s\n' "$OUTPUT_DIR"

  while [[ "$index" -lt "$total_batches" ]]; do
    local batch_number
    batch_number="$(printf '%02d' "$((index + 1))")"

    run_scanner "${BATCH_NAMES[$index]}" "$batch_number" "${BATCH_SOURCES[$index]}"

    if [[ "$index" -lt "$((total_batches - 1))" ]]; then
      sleep "$SLEEP_SECONDS"
    fi

    index="$((index + 1))"
  done

  printf '\nBatch summary\n'
  printf '%s\n' '-------------'
  printf '%s\n' "${RESULTS[@]}"

  for result in "${RESULTS[@]}"; do
    IFS='|' read -r batch_index batch_name status log_file <<<"$result"
    printf '%s %s %s %s\n' "$batch_index" "$batch_name" "$status" "$log_file"
  done

  for result in "${RESULTS[@]}"; do
    if [[ "$result" == *'|failed('* ]]; then
      return 1
    fi
  done

  return 0
}

main "$@"