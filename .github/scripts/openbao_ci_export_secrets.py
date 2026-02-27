#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import urllib.request


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(2)


def normalize_openbao_addr(raw: str) -> str:
    addr = raw.strip().rstrip("/")
    if addr.endswith("/v1"):
        addr = addr[:-3]
    return addr.rstrip("/")


def req_json(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"X-Vault-Token": token, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def add_mask(v: str) -> None:
    print(f"::add-mask::{v}")


def write_env(k: str, v: str) -> None:
    env_path = os.environ.get("GITHUB_ENV")
    if not env_path:
        die("GITHUB_ENV missing (must run inside GitHub Actions)")
    with open(env_path, "a", encoding="utf-8") as f:
        f.write(f"{k}={v}\n")


def main() -> int:
    bao = normalize_openbao_addr(os.environ.get("OPENBAO_ADDR") or "")
    token = (os.environ.get("OPENBAO_TOKEN") or "").strip()
    if not bao:
        die("OPENBAO_ADDR missing")
    if not token:
        die("OPENBAO_TOKEN missing (run openbao_ci_login first)")

    pg = (req_json(f"{bao}/v1/secret/neanelu/ci/postgres", token).get("data") or {})
    rd = (req_json(f"{bao}/v1/secret/neanelu/ci/redis", token).get("data") or {})

    # Postgres CI metadata (non-sensitive)
    write_env("CI_CT107_HOST", str(pg.get("ct107_host", "10.0.1.107")))
    write_env("CI_CT107_PORT", str(pg.get("ct107_port", "5432")))
    write_env("CI_DB_PROD", str(pg.get("db_prod", "neanelu_shopify")))
    write_env("CI_DB_STAGING", str(pg.get("db_staging", "neanelu_shopify_staging")))
    write_env("CI_DB_DEV", str(pg.get("db_dev", "neanelu_shopify_dev")))

    # Redis CI credentials (sensitive)
    redis_host = str(rd.get("host", "10.0.1.10"))
    redis_port = str(rd.get("port", "6379"))
    redis_user = str(rd.get("username", "neanelu-ci"))
    redis_pass = str(rd.get("password", ""))
    if not redis_pass:
        die("secret/neanelu/ci/redis missing password")

    add_mask(redis_pass)
    write_env("CI_REDIS_HOST", redis_host)
    write_env("CI_REDIS_PORT", redis_port)
    write_env("CI_REDIS_USERNAME", redis_user)
    write_env("CI_REDIS_PASSWORD", redis_pass)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

