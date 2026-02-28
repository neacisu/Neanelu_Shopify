#!/usr/bin/env python3

from __future__ import annotations

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
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip()
    return data


def req_json(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    body = None
    headers = {
        "X-Vault-Token": token,
        "Content-Type": "application/json",
    }
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
    if not env_path.exists():
        print(f"ERROR: env file not found: {env_path}", file=sys.stderr)
        return 2

    env = load_env_file(env_path)
    bao_addr = env.get("OPENBAO_ADDR") or env.get("BAO_ADDR")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR or OPENBAO_ROOT_TOKEN_ACTIVE in env file", file=sys.stderr)
        return 2

    bao_addr = bao_addr.rstrip("/")

    # 1) Health check (no token required, but use it anyway)
    health = req_json("GET", f"{bao_addr}/v1/sys/health", token)
    if health.get("sealed") is True:
        print("ERROR: OpenBao sealed", file=sys.stderr)
        return 3
    print("openbao_ok", health.get("version", "unknown"))

    repo_root = Path(__file__).resolve().parents[2]
    policies_dir = repo_root / "infra" / "config" / "openbao" / "policies"
    if not policies_dir.exists():
        print(f"ERROR: policies dir missing: {policies_dir}", file=sys.stderr)
        return 2

    policies = {
        "neanelu-prod-api": policies_dir / "neanelu-prod-api.hcl",
        "neanelu-staging-api": policies_dir / "neanelu-staging-api.hcl",
        "neanelu-dev-api": policies_dir / "neanelu-dev-api.hcl",
        "neanelu-infra": policies_dir / "neanelu-infra.hcl",
        "neanelu-cicd": policies_dir / "neanelu-cicd.hcl",
    }

    # 2) Write policies
    for name, f in policies.items():
        policy_text = f.read_text(encoding="utf-8", errors="replace")
        req_json("PUT", f"{bao_addr}/v1/sys/policy/{name}", token, {"policy": policy_text})
        print("policy_written", name)

    # 3) Ensure approle auth enabled
    auths = req_json("GET", f"{bao_addr}/v1/sys/auth", token)
    if "approle/" not in auths:
        req_json("POST", f"{bao_addr}/v1/sys/auth/approle", token, {"type": "approle", "description": "AppRole auth"})
        print("auth_enabled", "approle")
    else:
        print("auth_present", "approle")

    # 4) Create/update roles
    roles = {
        "neanelu-prod-api": ["neanelu-prod-api"],
        "neanelu-staging-api": ["neanelu-staging-api"],
        "neanelu-dev-api": ["neanelu-dev-api"],
        "neanelu-infra": ["neanelu-infra"],
        "neanelu-cicd": ["neanelu-cicd"],
    }

    for role, role_policies in roles.items():
        # CI/CD runner is local infrastructure (CT108) — secret_id never expires.
        # Agent-based roles use 168h TTL because agents auto-renew via file-based AppRole.
        sid_ttl = "0" if role == "neanelu-cicd" else "168h"
        req_json(
            "POST",
            f"{bao_addr}/v1/auth/approle/role/{role}",
            token,
            {
                "token_policies": role_policies,
                "token_ttl": "24h",
                "token_max_ttl": "72h",
                "token_num_uses": 0,
                "secret_id_num_uses": 0,
                "secret_id_ttl": sid_ttl,
                "bind_secret_id": True,
            },
        )
        print("approle_written", role, f"(secret_id_ttl={sid_ttl})")

        role_id_resp = req_json("GET", f"{bao_addr}/v1/auth/approle/role/{role}/role-id", token)
        role_id = (role_id_resp.get("data") or {}).get("role_id")
        if not role_id:
            raise RuntimeError(f"Missing role_id for {role}")

        # Store role_id (non-secret) for ops visibility.
        req_json(
            "POST",
            f"{bao_addr}/v1/secret/neanelu/infra/approle/{role}",
            token,
            {"role_id": role_id, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        )
        print("role_id_written", role)

    # 5) Create a non-secret bootstrap marker in KV (creates paths)
    req_json(
        "POST",
        f"{bao_addr}/v1/secret/neanelu/shared/_bootstrap",
        token,
        {"project": "neanelu", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    )
    print("kv_bootstrap_written")

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

