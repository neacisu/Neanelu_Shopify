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


def req_json(method: str, url: str, token: str) -> dict:
    headers = {"X-Vault-Token": token}
    req = urllib.request.Request(url, headers=headers, method=method)
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
    ap.add_argument("--bao-role", required=True)
    ap.add_argument("--ssh-to", required=True, help="Host alias that runs PgBouncer")
    ap.add_argument("--db-name", required=True)
    ap.add_argument("--pgbouncer-host", default="127.0.0.1")
    ap.add_argument("--pgbouncer-port", default="6432")
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

    # Run psql via PgBouncer on the target host; do not print credentials.
    q = "SELECT current_user, current_database(), inet_client_addr();"
    remote = (
        f"PGPASSWORD={password} psql -h {args.pgbouncer_host} -p {args.pgbouncer_port} "
        f"-U {username} -d {args.db_name} -v ON_ERROR_STOP=1 -Atc {json.dumps(q)}"
    )
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", args.ssh_to, remote],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        print("ERROR: psql via PgBouncer failed", file=sys.stderr)
        print(p.stderr.strip()[:800], file=sys.stderr)
        return 4

    print("ok", p.stdout.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

