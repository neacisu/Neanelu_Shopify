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
    headers = {"X-Vault-Token": token, "Accept": "application/json"}
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            b = resp.read()
            return {} if not b else json.loads(b.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:400]}") from None


def ssh_write_file(host: str, path: str, content: str, mode: str, owner: str) -> None:
    # Content goes via STDIN to avoid leaking in argv.
    remote = (
        f"umask 077 && mkdir -p $(dirname {sh_quote(path)})"
        f" && cat > {sh_quote(path)}"
        f" && chown {sh_quote(owner)} {sh_quote(path)}"
        f" && chmod {sh_quote(mode)} {sh_quote(path)}"
    )
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", host, "bash", "-lc", remote],
        input=content,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if p.returncode != 0:
        raise RuntimeError((p.stderr or "").strip()[-800:] or f"ssh write failed rc={p.returncode}")


def sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


def main() -> int:
    ap = argparse.ArgumentParser(description="Bootstrap-render PgBouncer runtime secrets on a CT from OpenBao KV.")
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument("--ssh-to", required=True, help="Target host alias (CT111/CT112)")
    ap.add_argument("--runtime-dir", default="/run/neanelu/runtime-secrets/infra")
    ap.add_argument("--secret-path", default="secret/neanelu/infra/pgbouncer")
    ap.add_argument("--owner", default="1000:1000", help="File owner for rendered secrets (matches container UID:GID).")
    args = ap.parse_args()

    env = load_env_file(Path(args.env_path))
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    sec = req_json("GET", f"{bao_addr}/v1/{args.secret_path}", token)
    data = sec.get("data") or {}
    auth_user = str(data.get("auth_user") or "").strip()
    auth_password = str(data.get("auth_password") or "").strip()
    if not auth_user or not auth_password:
        print(f"ERROR: missing auth_user/auth_password in {args.secret_path}", file=sys.stderr)
        return 3

    userlist = f"\"{auth_user}\" \"{auth_password}\"\n"
    pgbouncer_ini = f"""# Auto-generated bootstrap (should be managed by OpenBao Agent infra)
[databases]
* = host=10.0.1.107 port=5432

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432

auth_type = scram-sha-256
auth_dbname = postgres
auth_user = {auth_user}
auth_query = SELECT usename, passwd FROM public.neanelu_pgbouncer_get_auth($1);
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction
server_reset_query = DISCARD ALL
max_client_conn = 1000
default_pool_size = 50
"""

    ssh_write_file(args.ssh_to, f"{args.runtime_dir}/userlist.txt", userlist, "0600", owner=args.owner)
    ssh_write_file(args.ssh_to, f"{args.runtime_dir}/pgbouncer.ini", pgbouncer_ini, "0644", owner=args.owner)

    print("rendered", args.ssh_to, args.runtime_dir)
    return 0


if __name__ == "__main__":
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

