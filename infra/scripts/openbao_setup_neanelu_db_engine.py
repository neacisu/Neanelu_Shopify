#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import secrets
import shlex
import subprocess
import sys
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
    headers = {"X-Vault-Token": token, "Content-Type": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            b = resp.read()
            return {} if not b else json.loads(b.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:500]}") from None


def ensure_mount(bao_addr: str, token: str, mount_path: str) -> None:
    mounts = req_json("GET", f"{bao_addr}/v1/sys/mounts", token)
    if f"{mount_path}/" in mounts:
        print("mount_present", mount_path)
        return
    req_json(
        "POST",
        f"{bao_addr}/v1/sys/mounts/{mount_path}",
        token,
        {"type": "database", "description": "Neanelu DB dynamic creds (CT107)"},
    )
    print("mount_enabled", mount_path)


def rotate_neanelu_vault_password(ct107_ssh: str) -> str:
    # urlsafe => no quotes/spaces; safe to pass to psql literal.
    new_pw = secrets.token_urlsafe(32)
    remote_argv = [
        "sudo",
        "-u",
        "postgres",
        "psql",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        f"ALTER ROLE neanelu_vault WITH PASSWORD '{new_pw}';",
    ]
    remote_cmd = " ".join(shlex.quote(x) for x in remote_argv)

    cmd = [
        "ssh",
        "-o",
        "BatchMode=yes",
        # Avoid touching /root/.ssh/known_hosts when running under sandbox restrictions.
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        ct107_ssh,
        remote_cmd,
    ]
    p = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        # Never include the password (command args) in errors.
        err = (p.stderr or "").strip().splitlines()
        err_tail = "\\n".join(err[-10:]) if err else "(no stderr)"
        raise RuntimeError(f"Failed to rotate neanelu_vault password on CT107 via ssh (rc={p.returncode}): {err_tail}")
    return new_pw


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument("--ct107-ssh", default="postgres-main")
    ap.add_argument("--mount-path", default="neanelu-db")
    ap.add_argument("--config-name", default="neanelu-ct107")
    args = ap.parse_args()

    env = load_env_file(Path(args.env_path))
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    # Health check (no secrets printed)
    health = req_json("GET", f"{bao_addr}/v1/sys/health", token)
    if health.get("sealed") is True:
        print("ERROR: OpenBao sealed", file=sys.stderr)
        return 3
    print("openbao_ok", health.get("version", "unknown"))

    ensure_mount(bao_addr, token, args.mount_path)

    # Rotate DB admin password (never printed); OpenBao will store it in its config.
    pw = rotate_neanelu_vault_password(args.ct107_ssh)
    print("ct107_vault_password_rotated", "ok")

    # Configure DB connection (admin role neanelu_vault).
    cfg_payload = {
        "plugin_name": "postgresql-database-plugin",
        "allowed_roles": ["neanelu-prod-dynamic", "neanelu-staging-dynamic", "neanelu-dev-dynamic"],
        "connection_url": "postgresql://{{username}}:{{password}}@10.0.1.107:5432/postgres?sslmode=disable",
        "username": "neanelu_vault",
        "password": pw,
        "verify_connection": True,
    }
    req_json("POST", f"{bao_addr}/v1/{args.mount_path}/config/{args.config_name}", token, cfg_payload)
    print("db_config_written", args.config_name)

    # Roles: create a dynamic login role that is member of neanelu_app.
    creation = (
        "CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';\n"
        "GRANT neanelu_app TO \"{{name}}\";\n"
    )
    for role_name, ttl, max_ttl in [
        ("neanelu-prod-dynamic", "1h", "24h"),
        ("neanelu-staging-dynamic", "1h", "24h"),
        ("neanelu-dev-dynamic", "2h", "24h"),
    ]:
        role_payload = {
            "db_name": args.config_name,
            "creation_statements": creation,
            "default_ttl": ttl,
            "max_ttl": max_ttl,
        }
        req_json("POST", f"{bao_addr}/v1/{args.mount_path}/roles/{role_name}", token, role_payload)
        print("db_role_written", role_name)

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

