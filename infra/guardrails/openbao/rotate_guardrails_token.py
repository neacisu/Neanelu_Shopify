#!/usr/bin/env python3
"""
Rotate guardrails token stored in OpenBao KV v2.

Required env vars:
- OPENBAO_ADDR
- OPENBAO_ROLE_ID
- OPENBAO_SECRET_ID
- OPENBAO_NAMESPACE (optional)
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
from typing import Dict


def run(cmd: list[str], env: Dict[str, str]) -> str:
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def main() -> int:
    addr = os.getenv("OPENBAO_ADDR")
    role_id = os.getenv("OPENBAO_ROLE_ID")
    secret_id = os.getenv("OPENBAO_SECRET_ID")
    if not addr or not role_id or not secret_id:
        raise RuntimeError("Missing OPENBAO_ADDR/OPENBAO_ROLE_ID/OPENBAO_SECRET_ID")

    env = dict(os.environ)
    env["BAO_ADDR"] = addr

    login_out = run(
        [
            "bao",
            "write",
            "-format=json",
            "auth/approle/login",
            f"role_id={role_id}",
            f"secret_id={secret_id}",
        ],
        env,
    )
    token = json.loads(login_out)["auth"]["client_token"]
    env["BAO_TOKEN"] = token

    new_token = secrets.token_hex(64)
    run(["bao", "kv", "put", "kv-llm/guardrails", f"auth_token={new_token}"], env)
    print("guardrails token rotated")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
