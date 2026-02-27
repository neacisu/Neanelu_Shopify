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


def req_json(method: str, url: str, payload: dict | None = None, token: str | None = None) -> dict:
    body = None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["X-Vault-Token"] = token
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
        if not data:
            return {}
        return json.loads(data.decode("utf-8", errors="replace"))


def write_env(k: str, v: str) -> None:
    env_path = os.environ.get("GITHUB_ENV")
    if not env_path:
        die("GITHUB_ENV missing (must run inside GitHub Actions)")
    with open(env_path, "a", encoding="utf-8") as f:
        f.write(f"{k}={v}\n")


def add_mask(v: str) -> None:
    # Standard GitHub Actions masking directive.
    # Avoid additional output after this call.
    print(f"::add-mask::{v}")


def main() -> int:
    bao = normalize_openbao_addr(os.environ.get("OPENBAO_ADDR") or "")
    rid = (os.environ.get("OPENBAO_CICD_ROLE_ID") or "").strip()
    sid = (os.environ.get("OPENBAO_CICD_SECRET_ID") or "").strip()
    if not bao:
        die("OPENBAO_ADDR missing")
    if not rid:
        die("OPENBAO_CICD_ROLE_ID missing")
    if not sid:
        die("OPENBAO_CICD_SECRET_ID missing")

    # Login via AppRole
    resp = req_json(
        "POST",
        f"{bao}/v1/auth/approle/login",
        payload={"role_id": rid, "secret_id": sid},
    )
    token = (((resp.get("auth") or {}) or {}).get("client_token") or "").strip()
    if not token:
        die("OpenBao login failed (no client_token)")

    # Mask secrets early.
    add_mask(token)
    add_mask(sid)

    write_env("OPENBAO_TOKEN", token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

