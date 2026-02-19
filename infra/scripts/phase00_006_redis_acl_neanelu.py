#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
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
    headers = {"X-Vault-Token": token, "Content-Type": "application/json"}
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


def openbao_get_kv(bao_addr: str, token: str, path: str) -> dict | None:
    try:
        resp = req_json("GET", f"{bao_addr}/v1/{path.lstrip('/')}", token)
        return resp.get("data") or {}
    except RuntimeError as e:
        if " 404 " in str(e):
            return None
        raise


def openbao_put_kv(bao_addr: str, token: str, path: str, data: dict) -> None:
    req_json("POST", f"{bao_addr}/v1/{path.lstrip('/')}", token, data)


def ssh(cmd: list[str], stdin: str | None = None) -> str:
    proc = subprocess.run(
        ["ssh", "orchestrator"] + cmd,
        input=(stdin.encode("utf-8") if stdin is not None else None),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    return proc.stdout.decode("utf-8", errors="replace")


def ssh_shell(command: str, stdin: str | None = None) -> str:
    """
    Run a single remote shell command.
    Prefer this when arguments/quoting matter (ssh joins args via remote shell).
    """
    proc = subprocess.run(
        ["ssh", "orchestrator", command],
        input=(stdin.encode("utf-8") if stdin is not None else None),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    return proc.stdout.decode("utf-8", errors="replace")


def ensure_redis_conf_users() -> None:
    """
    Align with Cerniq pattern: Redis ACL users are managed via /opt/redis-shared/redis.conf,
    not via dynamic ACL commands (because the bootstrap user has -acl).
    """
    py = r"""
from pathlib import Path
import time

p = Path("/opt/redis-shared/redis.conf")
text = p.read_text("utf-8", errors="replace")
lines = text.splitlines()

prod = "user neanelu-prod on > ~neanelu:prod:* &neanelu:prod:* &queue_config_changed +@all -acl -config -shutdown"
stg  = "user neanelu-staging on > ~neanelu:staging:* &neanelu:staging:* &queue_config_changed +@all -acl -config -shutdown"
dev  = "user neanelu-dev on > ~neanelu:dev:* &neanelu:dev:* &queue_config_changed +@all -acl -config -shutdown"

def has_user(user: str) -> bool:
    prefix = f"user {user} "
    return any(l.strip().startswith(prefix) for l in lines)

to_add = []
if not has_user("neanelu-prod"):
    to_add.append(prod)
if not has_user("neanelu-staging"):
    to_add.append(stg)
if not has_user("neanelu-dev"):
    to_add.append(dev)

if not to_add:
    print("no_change")
else:
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    bak = f"/opt/redis-shared/redis.conf.bak.neanelu.{ts}"
    Path(bak).write_text(text, encoding="utf-8")
    with p.open("a", encoding="utf-8") as f:
        if not text.endswith("\n"):
            f.write("\n")
        for l in to_add:
            f.write(l + "\n")
    print("appended", len(to_add))
"""
    # Use stdin to avoid shell quoting issues over ssh.
    out = ssh_shell("python3 -", stdin=py)
    if "appended" in out or "no_change" in out:
        return
    raise RuntimeError(f"Failed to patch redis.conf: {out[:500]}")


def main() -> int:
    env_path = Path(os.environ.get("CERNIQ_ENV_PATH", "/var/www/CerniqAPP/.env"))
    env = load_env_file(env_path)
    bao_addr = (env.get("OPENBAO_ADDR") or env.get("BAO_ADDR") or "").rstrip("/")
    token = env.get("OPENBAO_ROOT_TOKEN_ACTIVE") or env.get("OPENBAO_ROOT_TOKEN_INITIAL") or env.get("BAO_TOKEN") or ""
    if not bao_addr or not token:
        print("ERROR: missing OPENBAO_ADDR or OPENBAO_ROOT_TOKEN_ACTIVE", file=sys.stderr)
        return 2

    # Health check
    health = req_json("GET", f"{bao_addr}/v1/sys/health", token)
    if health.get("sealed") is True:
        print("ERROR: OpenBao sealed", file=sys.stderr)
        return 3

    # Store non-secret connection info in KV v1 (password empty, like current Cerniq user).
    common = {
        "redis_host": "10.0.0.2",
        "redis_port": 6379,
        "redis_password": "",
        "auth_mode": "empty_password_like_cerniq",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    openbao_put_kv(
        bao_addr,
        token,
        "secret/neanelu/prod/redis",
        {**common, "redis_username": "neanelu-prod", "redis_key_pattern": "neanelu:prod:*"},
    )
    openbao_put_kv(
        bao_addr,
        token,
        "secret/neanelu/staging/redis",
        {**common, "redis_username": "neanelu-staging", "redis_key_pattern": "neanelu:staging:*"},
    )
    openbao_put_kv(
        bao_addr,
        token,
        "secret/neanelu/dev/redis",
        {**common, "redis_username": "neanelu-dev", "redis_key_pattern": "neanelu:dev:*"},
    )
    print("openbao_kv_updated")

    # Apply via config file (pattern Cerniq) + restart container
    ensure_redis_conf_users()
    ssh_shell("docker restart redis-shared >/dev/null")

    # Docker can report "restarting" for a few seconds; avoid flakey exec.
    for _ in range(40):
        st = ssh_shell("docker inspect -f '{{.State.Running}} {{.State.Restarting}}' redis-shared 2>/dev/null || echo missing")
        if st.strip().startswith("true false"):
            break
        time.sleep(1)
    else:
        print("ERROR: redis-shared did not become ready after restart", file=sys.stderr)
        print(st[:200], file=sys.stderr)
        return 4

    # Verify: PING as users (empty password) and key pattern isolation.
    # NOTE: redis-cli empty password must be quoted on remote shell.
    out1 = out2 = out3 = ""
    for _ in range(40):
        out1 = ssh_shell("docker exec redis-shared redis-cli --no-auth-warning --user neanelu-prod --pass \"\" PING")
        out2 = ssh_shell("docker exec redis-shared redis-cli --no-auth-warning --user neanelu-staging --pass \"\" PING")
        out3 = ssh_shell("docker exec redis-shared redis-cli --no-auth-warning --user neanelu-dev --pass \"\" PING")
        if all("PONG" in o for o in (out1, out2, out3)):
            break
        # During AOF load, Redis can return "LOADING ..." temporarily.
        if any("LOADING" in o for o in (out1, out2, out3)):
            time.sleep(1)
            continue
        time.sleep(1)
    else:
        print("ERROR: PING failed for Neanelu Redis users", file=sys.stderr)
        print((out1 + "\n" + out2 + "\n" + out3)[:500], file=sys.stderr)
        return 5

    prod_out = ssh_shell(
        "docker exec -i redis-shared redis-cli --no-auth-warning --user neanelu-prod --pass \"\"",
        stdin="\n".join(["SET neanelu:prod:smoke 1", "GET neanelu:prod:smoke", "SET neanelu:staging:smoke 1"]),
    )
    if "NOPERM" not in prod_out:
        print("ERROR: expected NOPERM for prod user writing staging prefix", file=sys.stderr)
        print(prod_out[:500], file=sys.stderr)
        return 6

    stg_out = ssh_shell(
        "docker exec -i redis-shared redis-cli --no-auth-warning --user neanelu-staging --pass \"\"",
        stdin="\n".join(["SET neanelu:staging:smoke 1", "GET neanelu:staging:smoke", "SET neanelu:prod:smoke 1"]),
    )
    if "NOPERM" not in stg_out:
        print("ERROR: expected NOPERM for staging user writing prod prefix", file=sys.stderr)
        print(stg_out[:500], file=sys.stderr)
        return 7

    dev_out = ssh_shell(
        "docker exec -i redis-shared redis-cli --no-auth-warning --user neanelu-dev --pass \"\"",
        stdin="\n".join(["SET neanelu:dev:smoke 1", "GET neanelu:dev:smoke", "SET neanelu:prod:smoke 1"]),
    )
    if "NOPERM" not in dev_out:
        print("ERROR: expected NOPERM for dev user writing prod prefix", file=sys.stderr)
        print(dev_out[:500], file=sys.stderr)
        return 8

    print("redis_isolation_ok")

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

