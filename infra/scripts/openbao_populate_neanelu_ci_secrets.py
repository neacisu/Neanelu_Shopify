#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import secrets
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
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
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
            if not b:
                return {}
            return json.loads(b.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:500]}") from None


def main() -> int:
    env_path = Path(os.environ.get("CERNIQ_ENV_PATH", "/var/www/CerniqAPP/.env"))
    env = load_env_file(env_path)

    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR or OPENBAO_ROOT_TOKEN_ACTIVE in env file", file=sys.stderr)
        return 2

    health = req_json("GET", f"{bao_addr}/v1/sys/health", token)
    if health.get("sealed") is True:
        print("ERROR: OpenBao sealed", file=sys.stderr)
        return 3

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Postgres CI: we keep this secret non-sensitive by design; runtime uses dynamic creds for prod/staging/dev.
    postgres_ci = {
        "ct107_host": "10.0.1.107",
        "ct107_port": "5432",
        "db_prod": "neanelu_shopify",
        "db_staging": "neanelu_shopify_staging",
        "db_dev": "neanelu_shopify_dev",
        "dynamic_creds_prod_path": "neanelu-db/creds/neanelu-prod-dynamic",
        "dynamic_creds_staging_path": "neanelu-db/creds/neanelu-staging-dynamic",
        "dynamic_creds_dev_path": "neanelu-db/creds/neanelu-dev-dynamic",
        "clone_ssh_host": "10.0.1.107",
        "clone_ssh_user": "neanelu-ci",
        "clone_scripts_dir": "/opt/neanelu/infra/scripts",
        "updated_at": now,
    }
    req_json("POST", f"{bao_addr}/v1/secret/neanelu/ci/postgres", token, postgres_ci)

    # Redis CI: create/rotate a password. We output only sha256 for safe provisioning to Redis as hashed ACL password.
    redis_username = "neanelu-ci"
    redis_password = secrets.token_urlsafe(32)
    redis_sha256 = hashlib.sha256(redis_password.encode("utf-8")).hexdigest()

    redis_ci = {
        "host": "10.0.1.10",
        "port": "6379",
        "username": redis_username,
        "password": redis_password,
        "redis_acl_password_sha256": redis_sha256,
        "key_prefix": "neanelu:ci:",
        "updated_at": now,
    }
    req_json("POST", f"{bao_addr}/v1/secret/neanelu/ci/redis", token, redis_ci)

    # Do not print secrets; only print the sha256 (for Redis ACL #hash provisioning) and metadata.
    print("openbao_ci_secrets_written")
    print(f"redis_username={redis_username}")
    print(f"redis_password_sha256={redis_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

