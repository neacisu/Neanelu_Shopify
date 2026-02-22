#!/usr/bin/env bash
# =============================================================================
# Neanelu Shopify - Deployment Verification (smoke tests)
# =============================================================================
# Scop:
# - verifica rapid ca stack-ul de pe CT111/CT112 e functional dupa deploy
# - valida ca folosim resurse shared (CT107 Postgres, orchestrator Redis/Traefik/OpenBao)
#
# Rulare (pe CT111/CT112):
#   sudo bash /opt/neanelu/infra/scripts/verify-deployment.sh
#
# Strict mode:
#   STRICT=1 sudo bash /opt/neanelu/infra/scripts/verify-deployment.sh
#
# NOTE:
# - Nu afiseaza secrete; foloseste env_file randat de OpenBao agent.
# =============================================================================

set -euo pipefail

STRICT="${STRICT:-0}"
FAILED=0

pass() { echo "OK  $*"; }
warn() { echo "WARN $*" >&2; }
fail() {
  echo "FAIL $*" >&2
  FAILED=$((FAILED + 1))
}

need() { command -v "$1" >/dev/null 2>&1 || { fail "missing_bin=$1"; return 1; }; }

need docker
need curl

ENV_API="${ENV_API:-/run/neanelu/runtime-secrets/api/neanelu-api.env}"
ENV_WORKERS="${ENV_WORKERS:-/run/neanelu/runtime-secrets/workers/neanelu-workers.env}"
ENV_INFRA_DIR="${ENV_INFRA_DIR:-/run/neanelu/runtime-secrets/infra}"

echo "neanelu_verify host=$(hostname -f 2>/dev/null || hostname) strict=${STRICT}"

check_runtime_secrets() {
  if [[ ! -f "${ENV_API}" ]]; then
    fail "missing_env_api=${ENV_API}"
    return
  fi
  if [[ ! -f "${ENV_WORKERS}" ]]; then
    warn "missing_env_workers=${ENV_WORKERS} (workers may be disabled)"
  fi
  if [[ ! -f "${ENV_INFRA_DIR}/pgbouncer.ini" ]]; then
    fail "missing_pgbouncer_ini=${ENV_INFRA_DIR}/pgbouncer.ini"
    return
  fi
  if [[ ! -f "${ENV_INFRA_DIR}/userlist.txt" ]]; then
    fail "missing_userlist=${ENV_INFRA_DIR}/userlist.txt"
    return
  fi
  pass "runtime_secrets_present"
}

check_containers() {
  # Best-effort: show top-level status for neanelu containers on this host.
  docker ps --format 'table {{.Names}}\t{{.Status}}' | awk 'NR==1 || $1 ~ /^neanelu-/' || true
  pass "docker_ps_ok"
}

check_pgbouncer_connectivity() {
  # Use DATABASE_URL from OpenBao-rendered env file (dynamic creds, via PgBouncer service).
  # IMPORTANT: run inside docker network so "pgbouncer" resolves.
  if docker run --rm --network host --env-file "${ENV_API}" postgres:18-alpine \
    sh -lc 'pg_isready -h 127.0.0.1 -p 6432 >/dev/null 2>&1 && echo ok' | grep -q ok; then
    pass "pgbouncer_listen_6432"
  else
    fail "pgbouncer_not_ready"
  fi
}

check_redis_ping() {
  # Redis is shared in orchestrator; REDIS_URL includes username/password.
  if docker run --rm --network host --env-file "${ENV_API}" redis:8-alpine \
    sh -lc 'timeout 3 redis-cli -u "$REDIS_URL" PING' 2>/dev/null | grep -q PONG; then
    pass "redis_ping_ok"
  else
    fail "redis_ping_fail"
  fi
}

check_exporters() {
  # Local exporters are published on host ports (for Prometheus scrape via VIP).
  if curl -sf --max-time 3 http://127.0.0.1:65210/metrics >/dev/null; then
    pass "cadvisor_metrics_ok"
  else
    warn "cadvisor_metrics_missing"
  fi
  if curl -sf --max-time 3 http://127.0.0.1:65211/metrics >/dev/null; then
    pass "pgbouncer_exporter_metrics_ok"
  else
    warn "pgbouncer_exporter_metrics_missing"
  fi
  if curl -sf --max-time 3 http://127.0.0.1:9100/metrics >/dev/null; then
    pass "node_exporter_metrics_ok"
  else
    warn "node_exporter_metrics_missing"
  fi
}

main() {
  check_runtime_secrets
  check_containers
  check_pgbouncer_connectivity
  check_redis_ping
  check_exporters

  if [[ "${FAILED}" -gt 0 && "${STRICT}" == "1" ]]; then
    exit 1
  fi
  # Non-strict: exit 0 but print count for visibility
  echo "failed_checks=${FAILED}"
}

main "$@"

