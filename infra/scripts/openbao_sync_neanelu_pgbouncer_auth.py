#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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
        raise RuntimeError(f"{method} {url} failed: {e.code} {e.reason} body={b[:400]}") from None


def run_psql_via_ssh(ssh_host: str, database: str, sql: str) -> None:
    # Important: SQL is passed via STDIN so secrets do not appear in argv/process list.
    cmd = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        ssh_host,
        "sudo",
        "-u",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-f",
        "-",
    ]
    p = subprocess.run(
        cmd,
        input=sql,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()
        raise RuntimeError("psql failed: " + ("\\n".join(err[-30:]) if err else "(no stderr)"))


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync PgBouncer auth_user password from OpenBao into CT107.")
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument("--ct107-ssh", default="postgres-main")
    ap.add_argument("--secret-path", default="secret/neanelu/infra/pgbouncer")
    args = ap.parse_args()

    env = load_env_file(Path(args.env_path))
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    # Read KV v1 secret (will include plaintext auth_password; do NOT print it).
    sec = req_json("GET", f"{bao_addr}/v1/{args.secret_path}", token)
    data = sec.get("data") or {}
    auth_user = str(data.get("auth_user") or "").strip()
    auth_password = str(data.get("auth_password") or "").strip()
    if not auth_user or not auth_password:
        print(f"ERROR: missing auth_user/auth_password in {args.secret_path}", file=sys.stderr)
        return 3

    # PostgreSQL: ensure role exists and set its password (idempotent).
    # Use format(%I, %L) to avoid injection and handle special chars.
    sql_postgres = f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {sql_lit(auth_user)}) THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN', {sql_lit(auth_user)});
  END IF;
  EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', {sql_lit(auth_user)}, {sql_lit(auth_password)});
END $$;
"""
    run_psql_via_ssh(args.ct107_ssh, "postgres", sql_postgres)
    print("ct107_role_password_synced", auth_user)

    # Functions required by PgBouncer auth_query. Apply to prod + staging DBs.
    fn_sql = f"""
CREATE OR REPLACE FUNCTION public.neanelu_pgbouncer_get_auth(p_usename TEXT)
RETURNS TABLE (usename TEXT, passwd TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $fn$
  SELECT rolname::text AS usename, rolpassword::text AS passwd
  FROM pg_authid
  WHERE rolname = p_usename
$fn$;

REVOKE ALL ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.neanelu_pgbouncer_get_auth(TEXT) TO {ident(auth_user)};
"""
    run_psql_via_ssh(args.ct107_ssh, "neanelu_shopify", fn_sql)
    run_psql_via_ssh(args.ct107_ssh, "neanelu_shopify_staging", fn_sql)
    print("auth_query_function_applied", "prod+staging")

    return 0


def sql_lit(value: str) -> str:
    # SQL string literal (single-quoted) escaping.
    return "'" + value.replace("'", "''") + "'"


def ident(value: str) -> str:
    # Minimal identifier quoting for role names.
    if value and all(c.isalnum() or c == "_" for c in value) and not value[0].isdigit():
        return value
    return '"' + value.replace('"', '""') + '"'


if __name__ == "__main__":
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

