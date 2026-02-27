#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import urllib.error
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


def add_mask(value: str) -> None:
    print(f"::add-mask::{value}")


def write_env(key: str, value: str) -> None:
    env_path = os.environ.get("GITHUB_ENV")
    if not env_path:
        die("GITHUB_ENV missing (must run inside GitHub Actions)")
    with open(env_path, "a", encoding="utf-8") as handle:
        handle.write(f"{key}={value}\n")


def main() -> int:
    bao = normalize_openbao_addr(os.environ.get("OPENBAO_ADDR") or "")
    token = (os.environ.get("OPENBAO_TOKEN") or "").strip()
    if not bao:
        die("OPENBAO_ADDR missing")
    if not token:
        die("OPENBAO_TOKEN missing (run openbao_ci_login first)")

    # Priority order: explicit path -> prod -> staging -> dev.
    candidates = [
        (os.environ.get("OPENBAO_API_SECRET_PATH") or "").strip(),
        "secret/neanelu/prod/api",
        "secret/neanelu/staging/api",
        "secret/neanelu/dev/api",
    ]

    checked: list[str] = []
    bullmq_token = ""
    used_path = ""

    for path in candidates:
        if not path:
            continue
        checked.append(path)
        try:
            payload = req_json(f"{bao}/v1/{path}", token)
        except urllib.error.HTTPError as err:
            if err.code in (403, 404):
                continue
            raise

        data = payload.get("data") or {}
        current = str(data.get("bullmq_pro_token") or "").strip()
        if current:
            bullmq_token = current
            used_path = path
            break

    if not bullmq_token:
        die(f"bullmq_pro_token not found in OpenBao paths: {', '.join(checked)}")

    add_mask(bullmq_token)
    write_env("EXPORTED_BULLMQ_PRO_TOKEN", bullmq_token)
    write_env("EXPORTED_NPM_TASKFORCESH_TOKEN", bullmq_token)
    print(f"exported tokens from {used_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
