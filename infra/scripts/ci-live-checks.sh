#!/usr/bin/env bash
# =============================================================================
# Neanelu Shopify - CI Live Checks (pre/post)
# =============================================================================
# Scop:
# - Rulat in job-urile self-hosted (CT108) pentru a verifica live:
#   - conectivitate VIP (hz.247) 10.0.1.10:443/6379
#   - OpenBao health
#   - Postgres CT107 reachability
#   - endpoints ingest-only (otel-neanelu/logs-neanelu) (doar sa nu fie 403 cand allowlist e corect)
# - NU presupune parametri: are valori default, dar toate pot fi override prin env vars.
#
# Output:
# - text stabil, potrivit pentru upload ca artifact.
#
# IMPORTANT:
# - Nu printeaza secrete; nu face login OpenBao aici (doar health checks).
# =============================================================================

set -euo pipefail

VIP_HOST="${VIP_HOST:-10.0.1.10}"
VIP_HTTPS_PORT="${VIP_HTTPS_PORT:-443}"
VIP_REDIS_PORT="${VIP_REDIS_PORT:-6379}"
CT107_PG_HOST="${CT107_PG_HOST:-10.0.1.107}"
CT107_PG_PORT="${CT107_PG_PORT:-5432}"

OPENBAO_ADDR="${OPENBAO_ADDR:-}"

OTEL_INGEST_URL="${OTEL_INGEST_URL:-https://otel-neanelu.neanelu.ro}"
LOKI_INGEST_URL="${LOKI_INGEST_URL:-https://logs-neanelu.neanelu.ro}"

timeout_s="${TIMEOUT_S:-3}"

now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

say() { echo "[$(now_utc)] $*"; }

py_tcp_check() {
  # Usage: py_tcp_check host port label
  local host="$1"
  local port="$2"
  local label="$3"
  python3 - <<'PY'
import os, socket, sys
host=sys.argv[1]; port=int(sys.argv[2]); label=sys.argv[3]
timeout=float(os.environ.get("TIMEOUT_S","3"))
s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(timeout)
try:
    s.connect((host,port))
    print(f"OK  tcp_connect label={label} host={host} port={port}")
except Exception as e:
    print(f"FAIL tcp_connect label={label} host={host} port={port} err={type(e).__name__}:{e}")
    sys.exit(1)
finally:
    try: s.close()
    except Exception: pass
PY "$host" "$port" "$label"
}

curl_code() {
  # Usage: curl_code url label
  local url="$1"
  local label="$2"
  # -k because endpoints are behind Traefik + Cloudflare; in CI we only need status code.
  code="$(curl -sk --max-time "${timeout_s}" -o /dev/null -w "%{http_code}" "$url" || true)"
  # Note: 000 means network error/timeout.
  echo "INFO http_code label=${label} url=${url} code=${code}"
}

main() {
  say "neanelu_ci_live_checks host=$(hostname 2>/dev/null || true)"
  say "params vip=${VIP_HOST}:${VIP_HTTPS_PORT}/${VIP_REDIS_PORT} ct107=${CT107_PG_HOST}:${CT107_PG_PORT}"

  say "check tcp VIP HTTPS"
  py_tcp_check "${VIP_HOST}" "${VIP_HTTPS_PORT}" "vip_https"

  say "check tcp VIP Redis"
  # Redis may require auth; we only validate reachability at TCP layer.
  py_tcp_check "${VIP_HOST}" "${VIP_REDIS_PORT}" "vip_redis"

  say "check tcp CT107 Postgres"
  py_tcp_check "${CT107_PG_HOST}" "${CT107_PG_PORT}" "ct107_postgres"

  if [[ -n "${OPENBAO_ADDR}" ]]; then
    say "check OpenBao health"
    curl_code "${OPENBAO_ADDR%/}/v1/sys/health" "openbao_health"
  else
    say "skip OpenBao health (OPENBAO_ADDR empty)"
  fi

  say "check OTLP ingest endpoint reachability"
  curl_code "${OTEL_INGEST_URL%/}/" "otel_ingest_root"

  say "check Loki ingest endpoint reachability"
  curl_code "${LOKI_INGEST_URL%/}/ready" "loki_ready"
}

main "$@"

