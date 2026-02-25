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
    bao = (os.environ.get("OPENBAO_ADDR") or "").rstrip("/")
    token = (os.environ.get("OPENBAO_TOKEN") or "").strip()
    if not bao:
        die("OPENBAO_ADDR missing")
    if not token:
        die("OPENBAO_TOKEN missing (run openbao_ci_login first)")

    # BullMQ Pro token is stored in OpenBao API secrets.
    # We probe multiple paths to support current + legacy layouts.
    candidate_paths = [
        "secret/neanelu/ci/api",
        "secret/neanelu/prod/api",
        "secret/neanelu/staging/api",
        "secret/neanelu/dev/api",
    ]

    bullmq_token = ""
    used_path = ""
    for path in candidate_paths:
        try:
            payload = req_json(f"{bao}/v1/{path}", token)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                continue
            raise

        data = payload.get("data") or {}
        value = str(data.get("bullmq_pro_token") or "").strip()
        if value:
            bullmq_token = value
            used_path = path
            break

    if not bullmq_token:
        die("unable to read bullmq_pro_token from OpenBao (checked ci/prod/staging/dev api paths)")

    add_mask(bullmq_token)
    write_env("BULLMQ_PRO_TOKEN", bullmq_token)
    write_env("NPM_TASKFORCESH_TOKEN", bullmq_token)
    print(f"exported registry tokens from {used_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
