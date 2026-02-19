#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
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


def ssh_write_file(host: str, path: str, content: str, mode: str = "0400") -> None:
    # Content via STDIN so secrets don't appear in process list.
    remote = (
        f"umask 077 && mkdir -p $(dirname {sh_quote(path)})"
        f" && cat > {sh_quote(path)}"
        f" && chmod {sh_quote(mode)} {sh_quote(path)}"
        # OpenBao agent containers run as 1000:1000; ensure file is readable for that uid.
        f" && chown 1000:1000 {sh_quote(path)}"
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


@dataclass(frozen=True)
class AppRoleFiles:
    role: str
    role_id_path: str
    secret_id_path: str


def get_role_id(bao_addr: str, token: str, role: str) -> str:
    out = req_json("GET", f"{bao_addr}/v1/auth/approle/role/{role}/role-id", token)
    rid = (out.get("data") or {}).get("role_id")
    if not rid:
        raise RuntimeError(f"Missing role_id for {role}")
    return str(rid)


def generate_secret_id(bao_addr: str, token: str, role: str) -> str:
    out = req_json("POST", f"{bao_addr}/v1/auth/approle/role/{role}/secret-id", token, {})
    sid = (out.get("data") or {}).get("secret_id")
    if not sid:
        raise RuntimeError(f"Missing secret_id for {role}")
    return str(sid)


def main() -> int:
    ap = argparse.ArgumentParser(description="Provision /opt/neanelu/secrets/* AppRole files on CT111/CT112.")
    ap.add_argument("--env-path", default="/var/www/CerniqAPP/.env")
    ap.add_argument("--ssh-to", required=True)
    ap.add_argument(
        "--mode",
        choices=["prod", "staging", "dev"],
        required=True,
        help="Which set of AppRole files to write (prod/staging/dev).",
    )
    args = ap.parse_args()

    env = load_env_file(Path(args.env_path))
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN")
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR / OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    if args.mode == "prod":
        roles = [
            AppRoleFiles("neanelu-prod-api", "/opt/neanelu/secrets/prod_api_role_id", "/opt/neanelu/secrets/prod_api_secret_id"),
            AppRoleFiles(
                "neanelu-prod-workers",
                "/opt/neanelu/secrets/prod_workers_role_id",
                "/opt/neanelu/secrets/prod_workers_secret_id",
            ),
            # Infra role is shared in OpenBao; we still keep separate file names on disk.
            AppRoleFiles(
                "neanelu-infra",
                "/opt/neanelu/secrets/prod_infra_role_id",
                "/opt/neanelu/secrets/prod_infra_secret_id",
            ),
        ]
    elif args.mode == "staging":
        roles = [
            AppRoleFiles(
                "neanelu-staging-api",
                "/opt/neanelu/secrets/staging_api_role_id",
                "/opt/neanelu/secrets/staging_api_secret_id",
            ),
            AppRoleFiles(
                "neanelu-staging-workers",
                "/opt/neanelu/secrets/staging_workers_role_id",
                "/opt/neanelu/secrets/staging_workers_secret_id",
            ),
            AppRoleFiles(
                "neanelu-infra",
                "/opt/neanelu/secrets/staging_infra_role_id",
                "/opt/neanelu/secrets/staging_infra_secret_id",
            ),
        ]
    else:
        # Dev needs only API + workers; it can reuse the existing infra/pgbouncer stack.
        roles = [
            AppRoleFiles("neanelu-dev-api", "/opt/neanelu/secrets/dev_api_role_id", "/opt/neanelu/secrets/dev_api_secret_id"),
            AppRoleFiles(
                "neanelu-dev-workers",
                "/opt/neanelu/secrets/dev_workers_role_id",
                "/opt/neanelu/secrets/dev_workers_secret_id",
            ),
        ]

    for r in roles:
        role_id = get_role_id(bao_addr, token, r.role)
        secret_id = generate_secret_id(bao_addr, token, r.role)

        ssh_write_file(args.ssh_to, r.role_id_path, role_id + "\n", mode="0444")
        ssh_write_file(args.ssh_to, r.secret_id_path, secret_id + "\n", mode="0400")
        print("written", args.ssh_to, r.role)

    return 0


if __name__ == "__main__":
    os.environ.pop("http_proxy", None)
    os.environ.pop("https_proxy", None)
    raise SystemExit(main())

