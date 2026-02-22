#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument("--bao-mount", default="neanelu-db")
    ap.add_argument("--bao-role", default="neanelu-dev-dynamic")
    ap.add_argument("--ssh-from", default="neanelu-ci", help="Host alias that is allowed in pg_hba")
    ap.add_argument("--db-host", default="10.0.1.107")
    ap.add_argument("--db-name", default="neanelu_shopify_dev")
    args = ap.parse_args()

    env = load_env_file(Path(args.env_path))
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    resp = req_json("GET", f"{bao_addr}/v1/{args.bao_mount}/creds/{args.bao_role}", token)
    data = resp.get("data") or {}
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        print("ERROR: missing username/password in creds response", file=sys.stderr)
        return 3

    # Run psql on the allowed host; do not print credentials.
    q = "SELECT current_user, current_database(), inet_client_addr();"
    remote = (
        f"PGPASSWORD={password} psql -h {args.db_host} -p 5432 "
        f"-U {username} -d {args.db_name} -v ON_ERROR_STOP=1 -Atc {json.dumps(q)}"
    )
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", args.ssh_from, remote],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        print("ERROR: psql failed", file=sys.stderr)
        print(p.stderr.strip()[:800], file=sys.stderr)
        return 4

    # Output is: user|db|client_ip
    out = p.stdout.strip()
    print("ok", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

