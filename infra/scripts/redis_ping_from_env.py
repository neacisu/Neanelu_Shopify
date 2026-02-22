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


def read_line(s: socket.socket) -> bytes:
    buf = b""
    while not buf.endswith(b"\r\n"):
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    return buf


def main() -> int:
    u = os.environ.get("REDIS_URL", "")
    p = urllib.parse.urlparse(u)
    host = p.hostname or ""
    port = p.port or 6379
    user = urllib.parse.unquote(p.username or "")
    pw = urllib.parse.unquote(p.password or "")
    if not host:
        print("missing_redis_host")
        return 2

    s = socket.socket()
    s.settimeout(3)
    s.connect((host, port))
    # AUTH then PING; don't print secrets.
    if user:
        s.sendall(resp_array("AUTH", user, pw))
    else:
        s.sendall(resp_array("AUTH", pw))
    a = read_line(s)
    if not a.startswith(b"+"):
        print("auth_failed", a[:80])
        return 3
    s.sendall(resp_array("PING"))
    r = read_line(s)
    print("ping_reply", r[:80])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

