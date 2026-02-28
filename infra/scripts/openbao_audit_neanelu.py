#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_env_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    text = path.read_text(encoding="utf-8", errors="replace")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip()
    return data


def req_json(method: str, url: str, token: str | None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["X-Vault-Token"] = token
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            b = resp.read()
            return {} if not b else json.loads(b.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        # Never print tokens; body is truncated defensively.
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:400]}") from None


def check_ok(label: str, fn) -> tuple[bool, str]:
    try:
        fn()
        return (True, label)
    except Exception as e:  # noqa: BLE001 - we want a compact audit summary
        return (False, f"{label}: {e}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only audit for Neanelu OpenBao state (no writes).")
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    args = ap.parse_args()

    env_path = Path(args.env_path)
    if not env_path.exists():
        print(f"ERROR: env file not found: {env_path}", file=sys.stderr)
        return 2

    env = load_env_file(env_path)
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = (
        env.get("OPENBAO_ROOT_TOKEN_ACTIVE")
        or env.get("OPENBAO_ROOT_TOKEN_INITIAL")
        or env.get("BAO_TOKEN")
        or ""
    ).strip()
    if not bao_addr:
        print("ERROR: missing OPENBAO_ADDR/BAO_ADDR in env file", file=sys.stderr)
        return 2

    # Health check does not require a token.
    health = req_json("GET", f"{bao_addr}/v1/sys/health", token=None)
    sealed = bool(health.get("sealed"))
    print(f"openbao_health sealed={sealed} version={health.get('version', 'unknown')}")
    if sealed:
        print("ERROR: OpenBao is sealed; audit cannot continue safely.", file=sys.stderr)
        return 3

    if not token:
        print("ERROR: missing OpenBao admin token in env file (OPENBAO_ROOT_TOKEN_ACTIVE/...) ", file=sys.stderr)
        return 2

    mounts = req_json("GET", f"{bao_addr}/v1/sys/mounts", token)
    mount_keys = set((mounts or {}).keys())

    expected_mounts = ["secret/", "neanelu-db/"]
    for m in expected_mounts:
        print(f"mount_present {m}={str(m in mount_keys).lower()}")

    # Policies + roles expected by repo conventions.
    expected_policies = [
        "neanelu-prod-api",
        "neanelu-staging-api",
        "neanelu-dev-api",
        "neanelu-infra",
        "neanelu-cicd",
    ]
    expected_approles = [
        "neanelu-prod-api",
        "neanelu-staging-api",
        "neanelu-dev-api",
        "neanelu-infra",
        "neanelu-cicd",
    ]
    expected_db_roles = [
        "neanelu-prod-dynamic",
        "neanelu-staging-dynamic",
        "neanelu-dev-dynamic",
    ]

    checks: list[tuple[bool, str]] = []

    for pol in expected_policies:
        checks.append(
            check_ok(
                f"policy {pol}",
                lambda pol=pol: req_json("GET", f"{bao_addr}/v1/sys/policy/{pol}", token),
            )
        )

    # AppRole read
    for role in expected_approles:
        checks.append(
            check_ok(
                f"approle {role}",
                lambda role=role: req_json("GET", f"{bao_addr}/v1/auth/approle/role/{role}", token),
            )
        )

    # KV bootstrap marker (non-secret)
    checks.append(
        check_ok(
            "kv_bootstrap secret/neanelu/shared/_bootstrap",
            lambda: req_json("GET", f"{bao_addr}/v1/secret/neanelu/shared/_bootstrap", token),
        )
    )

    # Runtime secrets required by OpenBao agent templates (existence only; no values printed).
    for p in [
        "secret/neanelu/prod/api",
        "secret/neanelu/staging/api",
        "secret/neanelu/prod/redis",
        "secret/neanelu/staging/redis",
        "secret/neanelu/infra/pgbouncer",
    ]:
        checks.append(check_ok(f"kv_secret {p}", lambda p=p: req_json("GET", f"{bao_addr}/v1/{p}", token)))

    # DB engine config + roles
    checks.append(
        check_ok(
            "db_engine_config neanelu-db/config/neanelu-ct107",
            lambda: req_json("GET", f"{bao_addr}/v1/neanelu-db/config/neanelu-ct107", token),
        )
    )
    for r in expected_db_roles:
        checks.append(
            check_ok(
                f"db_engine_role {r}",
                lambda r=r: req_json("GET", f"{bao_addr}/v1/neanelu-db/roles/{r}", token),
            )
        )

    ok = 0
    for passed, msg in checks:
        if passed:
            ok += 1
            print("ok", msg)
        else:
            print("missing_or_error", msg)

    print(f"done checks_ok={ok} checks_total={len(checks)}")
    return 0


if __name__ == "__main__":
    # Avoid surprises if env has proxies etc.
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

