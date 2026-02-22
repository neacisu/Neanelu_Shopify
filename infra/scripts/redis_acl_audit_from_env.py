#!/usr/bin/env python3
from __future__ import annotations

import os
import socket
import urllib.parse


def resp_array(*parts: str) -> bytes:
    out = f"*{len(parts)}\r\n".encode()
    for p in parts:
        b = p.encode()
        out += f"${len(b)}\r\n".encode() + b + b"\r\n"
    return out


def read_reply_line(s: socket.socket) -> bytes:
    buf = b""
    while not buf.endswith(b"\r\n"):
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    return buf


def main() -> int:
    u = os.environ.get("REDIS_URL", "").strip()
    prefix = os.environ.get("REDIS_PREFIX", "").strip()
    if not u:
        print("missing_REDIS_URL")
        return 2

    p = urllib.parse.urlparse(u)
    host = p.hostname or ""
    port = p.port or 6379
    user = urllib.parse.unquote(p.username or "")
    pw = urllib.parse.unquote(p.password or "")
    if not host:
        print("missing_redis_host")
        return 3

    # Basic AUTH+PING to ensure credentials work.
    s = socket.socket()
    s.settimeout(3)
    s.connect((host, port))
    if user:
        s.sendall(resp_array("AUTH", user, pw))
    else:
        s.sendall(resp_array("AUTH", pw))
    auth = read_reply_line(s)
    if not auth.startswith(b"+"):
        print("auth_failed", auth[:120])
        return 4
    s.sendall(resp_array("PING"))
    pong = read_reply_line(s)
    if not pong.startswith(b"+PONG"):
        print("ping_unexpected", pong[:120])
        return 5

    # ACL identity (optional; some servers may restrict it).
    s.sendall(resp_array("ACL", "WHOAMI"))
    who = read_reply_line(s)
    # Do not hard-fail if ACL command is denied; it's still useful for debugging.
    if who.startswith(b"-"):
        whoami_ok = False
    else:
        whoami_ok = True

    # Write/read/delete within prefix.
    if not prefix:
        print("missing_REDIS_PREFIX")
        return 6
    key_ok = prefix + "__acl_audit_ok"
    s.sendall(resp_array("SET", key_ok, "1", "EX", "30"))
    set_ok = read_reply_line(s)
    if not set_ok.startswith(b"+OK"):
        print("set_ok_failed", set_ok[:120])
        return 7
    s.sendall(resp_array("GET", key_ok))
    get_ok = read_reply_line(s)
    if get_ok.startswith(b"-"):
        print("get_ok_failed", get_ok[:120])
        return 8
    s.sendall(resp_array("DEL", key_ok))
    _ = read_reply_line(s)

    # Isolation check: try writing to the other environment's namespace.
    # If current prefix is prod, staging should fail; and vice-versa.
    if prefix.startswith("neanelu:prod:"):
        other_key = "neanelu:staging:__acl_audit_forbidden"
    elif prefix.startswith("neanelu:staging:"):
        other_key = "neanelu:prod:__acl_audit_forbidden"
    else:
        # Unknown prefix pattern; don't guess.
        print("ok", "ping", "set_get_del", "whoami" if whoami_ok else "whoami_denied", "isolation_skipped")
        return 0

    s.sendall(resp_array("SET", other_key, "1", "EX", "30"))
    other = read_reply_line(s)
    # Expect NOPERM-like error for key pattern violation.
    if not other.startswith(b"-"):
        print("isolation_failed_unexpected_success")
        return 9

    print("ok", "ping", "set_get_del", "whoami" if whoami_ok else "whoami_denied", "isolation_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

