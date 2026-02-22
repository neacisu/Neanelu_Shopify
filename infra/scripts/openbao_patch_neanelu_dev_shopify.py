#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
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


def req_json(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    body = None
    headers = {"X-Vault-Token": token, "Content-Type": "application/json", "Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            b = resp.read()
            return {} if not b else json.loads(b.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:400]}") from None


def required(env: dict[str, str], key: str) -> str:
    v = (env.get(key) or "").strip()
    if not v:
        raise RuntimeError(f"Missing required key in env file: {key}")
    return v


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Patch OpenBao KV for Neanelu dev API (Shopify keys + APP_HOST) without printing secrets.\n"
            "Writes only to: secret/neanelu/dev/api"
        )
    )
    ap.add_argument("--openbao-env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument(
        "--dev-env-path",
        required=True,
        help="Local env file containing SHOPIFY_API_KEY, SHOPIFY_API_SECRET, APP_HOST (dev).",
    )
    args = ap.parse_args()

    ob_env = load_env_file(Path(args.openbao_env_path))
    bao_addr = (ob_env.get("OPENBAO_ADDR") or ob_env.get("BAO_ADDR") or "").rstrip("/")
    token = (
        ob_env.get("OPENBAO_ROOT_TOKEN_ACTIVE")
        or ob_env.get("OPENBAO_ROOT_TOKEN_INITIAL")
        or ob_env.get("BAO_TOKEN")
        or ""
    ).strip()
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    dev = load_env_file(Path(args.dev_env_path))
    patch = {
        "shopify_api_key": required(dev, "SHOPIFY_API_KEY"),
        "shopify_api_secret": required(dev, "SHOPIFY_API_SECRET"),
        "app_host": required(dev, "APP_HOST"),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "patched dev shopify keys + app_host",
    }

    path = "secret/neanelu/dev/api"
    current = req_json("GET", f"{bao_addr}/v1/{path}", token)
    current_data = (current.get("data") or {}) if isinstance(current, dict) else {}
    if not isinstance(current_data, dict):
        raise RuntimeError("Unexpected OpenBao response: missing data object")

    merged = dict(current_data)
    merged.update(patch)
    req_json("POST", f"{bao_addr}/v1/{path}", token, merged)

    print("written", path, "keys=shopify_api_key,shopify_api_secret,app_host (merged, other keys preserved)")
    return 0


if __name__ == "__main__":
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

