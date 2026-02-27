#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import urllib.request


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(2)


def clean_secret(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1].strip()
    return value


def normalize_openbao_addr(raw: str) -> str:
    addr = clean_secret(raw).rstrip("/")
    if addr.endswith("/v1"):
        addr = addr[:-3]
    return addr.rstrip("/")


def add_mask(v: str) -> None:
    print(f"::add-mask::{v}")


def write_env(k: str, v: str) -> None:
    env_path = os.environ.get("GITHUB_ENV")
    if not env_path:
        die("GITHUB_ENV missing (must run inside GitHub Actions)")
    with open(env_path, "a", encoding="utf-8") as f:
        f.write(f"{k}={v}\n")


def req_json(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"X-Vault-Token": token, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def main() -> int:
    bao = normalize_openbao_addr(os.environ.get("OPENBAO_ADDR") or "")
    token = clean_secret(os.environ.get("OPENBAO_TOKEN") or "")
    path = clean_secret(os.environ.get("OPENBAO_DB_CREDS_PATH") or "").lstrip("/")
    prefix = clean_secret(os.environ.get("OPENBAO_DB_ENV_PREFIX") or "DB")
    if not bao:
        die("OPENBAO_ADDR missing")
    if not token:
        die("OPENBAO_TOKEN missing")
    if not path:
        die("OPENBAO_DB_CREDS_PATH missing (e.g. neanelu-db/creds/neanelu-prod-dynamic)")

    data = (req_json(f"{bao}/v1/{path}", token).get("data") or {})
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    if not username or not password:
        die(f"Missing username/password at {path}")

    add_mask(password)
    write_env(f"{prefix}_USER", username)
    write_env(f"{prefix}_PASS", password)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

