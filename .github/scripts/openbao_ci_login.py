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


def read_token_from_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return clean_secret(f.read())
    except OSError:
        return ""


def req_json(method: str, url: str, payload: dict | None = None, token: str | None = None) -> dict:
    body = None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["X-Vault-Token"] = token
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
            if not data:
                return {}
            return json.loads(data.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace").strip()
        detail = raw
        try:
            parsed = json.loads(raw) if raw else {}
            errors = parsed.get("errors")
            if isinstance(errors, list) and errors:
                detail = "; ".join(str(e) for e in errors)
        except json.JSONDecodeError:
            pass
        die(f"OpenBao request failed: status={err.code} url={url} detail={detail}")


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
    rid = clean_secret(os.environ.get("OPENBAO_CICD_ROLE_ID") or "")
    sid = clean_secret(os.environ.get("OPENBAO_CICD_SECRET_ID") or "")
    token_env = clean_secret(os.environ.get("OPENBAO_TOKEN") or "")
    token_file = clean_secret(os.environ.get("OPENBAO_TOKEN_FILE") or "/run/openbao/token")
    if not bao:
        die("OPENBAO_ADDR missing")

    # Prefer already-issued OpenBao token (from agent/env), then fallback to AppRole login.
    existing_token = token_env or read_token_from_file(token_file)
    if existing_token:
        add_mask(existing_token)
        write_env("OPENBAO_TOKEN", existing_token)
        return 0

    if not rid:
        die("OPENBAO_CICD_ROLE_ID missing (and no OPENBAO_TOKEN/token file available)")
    if not sid:
        die("OPENBAO_CICD_SECRET_ID missing (and no OPENBAO_TOKEN/token file available)")

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

