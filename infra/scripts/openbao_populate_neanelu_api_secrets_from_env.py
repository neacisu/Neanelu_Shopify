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
        description="Populate OpenBao KV v1 secrets for Neanelu API templates from repo .env (no secrets printed)."
    )
    ap.add_argument("--openbao-env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument(
        "--source-env-path",
        default="/var/www/Neanelu_Shopify/.env",
        help="Source .env used for production by default.",
    )
    ap.add_argument(
        "--staging-source-env-path",
        default="",
        help="Optional: if provided, write staging secrets from this separate env file.",
    )
    ap.add_argument(
        "--dev-source-env-path",
        default="",
        help="Optional: if provided, write dev secrets from this separate env file.",
    )
    ap.add_argument(
        "--also-write-staging-from-source-env",
        action="store_true",
        help="DANGEROUS: write staging from --source-env-path too (legacy behavior).",
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

    src = load_env_file(Path(args.source_env_path))
    shopify_api_key = required(src, "SHOPIFY_API_KEY")
    shopify_api_secret = required(src, "SHOPIFY_API_SECRET")
    encryption_key_256 = required(src, "ENCRYPTION_KEY_256")
    encryption_key_version = required(src, "ENCRYPTION_KEY_VERSION")
    scopes = required(src, "SCOPES")
    app_host = required(src, "APP_HOST")
    bullmq_pro_token = required(src, "BULLMQ_PRO_TOKEN")

    payload = {
        "shopify_api_key": shopify_api_key,
        "shopify_api_secret": shopify_api_secret,
        "encryption_key_256": encryption_key_256,
        "encryption_key_version": encryption_key_version,
        "scopes": scopes,
        "app_host": app_host,
        "bullmq_pro_token": bullmq_pro_token,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "production api secrets",
    }

    # Production is always written from --source-env-path.
    prod_path = "secret/neanelu/prod/api"
    req_json("POST", f"{bao_addr}/v1/{prod_path}", token, payload)
    print("written", prod_path)

    # Staging must come from a dedicated Shopify app (distinct API key/secret) and app_host.
    # To avoid accidental cross-environment redirects, we do NOT write staging by default.
    if args.staging_source_env_path:
        st_src = load_env_file(Path(args.staging_source_env_path))
        st_payload = dict(payload)
        st_payload["shopify_api_key"] = required(st_src, "SHOPIFY_API_KEY")
        st_payload["shopify_api_secret"] = required(st_src, "SHOPIFY_API_SECRET")
        st_payload["app_host"] = required(st_src, "APP_HOST")
        st_payload["scopes"] = required(st_src, "SCOPES")
        st_payload["bullmq_pro_token"] = required(st_src, "BULLMQ_PRO_TOKEN")
        st_payload["encryption_key_256"] = required(st_src, "ENCRYPTION_KEY_256")
        st_payload["encryption_key_version"] = required(st_src, "ENCRYPTION_KEY_VERSION")
        st_payload["note"] = "staging api secrets"
        st_path = "secret/neanelu/staging/api"
        req_json("POST", f"{bao_addr}/v1/{st_path}", token, st_payload)
        print("written", st_path)
    elif args.also_write_staging_from_source_env:
        st_path = "secret/neanelu/staging/api"
        legacy = dict(payload)
        legacy["note"] = "LEGACY: staging written from production source env (NOT RECOMMENDED)"
        req_json("POST", f"{bao_addr}/v1/{st_path}", token, legacy)
        print("written", st_path)
    else:
        print(
            "skip secret/neanelu/staging/api (provide --staging-source-env-path to write staging safely)",
            file=sys.stderr,
        )

    # Dev should use its own Shopify app key/secret + app_host.
    if args.dev_source_env_path:
        dev_src = load_env_file(Path(args.dev_source_env_path))
        dev_payload = dict(payload)
        dev_payload["shopify_api_key"] = required(dev_src, "SHOPIFY_API_KEY")
        dev_payload["shopify_api_secret"] = required(dev_src, "SHOPIFY_API_SECRET")
        dev_payload["app_host"] = required(dev_src, "APP_HOST")
        dev_payload["scopes"] = required(dev_src, "SCOPES")
        dev_payload["bullmq_pro_token"] = required(dev_src, "BULLMQ_PRO_TOKEN")
        dev_payload["encryption_key_256"] = required(dev_src, "ENCRYPTION_KEY_256")
        dev_payload["encryption_key_version"] = required(dev_src, "ENCRYPTION_KEY_VERSION")
        dev_payload["note"] = "dev api secrets"
        dev_path = "secret/neanelu/dev/api"
        req_json("POST", f"{bao_addr}/v1/{dev_path}", token, dev_payload)
        print("written", dev_path)
    else:
        print("skip secret/neanelu/dev/api (provide --dev-source-env-path to write dev safely)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

