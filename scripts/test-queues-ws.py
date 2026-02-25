#!/usr/bin/env python3
"""
Test WebSocket /api/queues/ws: conectare și monitorizare mesaje 20s.
Folosire:
  export BASE_WS_URL=http://127.0.0.1:65101   # optional, default acesta
  export SESSION_TOKEN=...                    # optional; ia din browser (DevTools -> Network -> ws -> Query String sau din /api/session/token)
  python3 scripts/test-queues-ws.py

Dacă nu trimiți SESSION_TOKEN, conexiunea va primi 401 (backend cere sesiune).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from urllib.parse import urlencode, urlparse


def main() -> None:
    try:
        import websockets
    except ImportError:
        print("Lipsește pachetul: pip install websockets")
        sys.exit(1)

    base = os.environ.get("BASE_WS_URL", "http://127.0.0.1:65101").strip()
    token = os.environ.get("SESSION_TOKEN", "").strip()
    parsed = urlparse(base)
    scheme_ws = "wss" if parsed.scheme == "https" else "ws"
    netloc = parsed.netloc or parsed.path
    path = "/api/queues/ws"
    if token:
        path += "?" + urlencode({"token": token})
    uri = f"{scheme_ws}://{netloc}{path}"
    print(f"Conectare la {uri} ...")
    if not token:
        print("(Nu e setat SESSION_TOKEN; backend-ul poate returna 401.)")

    async def run() -> None:
        try:
            async with websockets.connect(
                uri,
                ping_interval=None,
                ping_timeout=None,
                close_timeout=10,
            ) as ws:
                print("Conectat. Aștept mesaje 20s (refresh la ~0s și ~15s)...\n")
                snapshot_count = 0
                start = time.monotonic()
                while (time.monotonic() - start < 20):
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
                    except asyncio.TimeoutError:
                        print(".", end="", flush=True)
                        continue
                    try:
                        obj = json.loads(msg)
                        evt = obj.get("event", "?")
                        data = obj.get("data") or {}
                        if evt == "queues.snapshot":
                            snapshot_count += 1
                            queues = data.get("queues")
                            n = len(queues) if isinstance(queues, list) else 0
                            initial = data.get("initial", False)
                            err = data.get("error")
                            ts = data.get("timestamp", "")
                            print(f"\n[snapshot #{snapshot_count}] initial={initial} queues={n} error={err!r} timestamp={ts}")
                            if not initial and isinstance(queues, list) and queues:
                                for q in queues[:3]:
                                    print(f"  - {q.get('name')}: w={q.get('waiting')} a={q.get('active')} f={q.get('failed')}")
                                if len(queues) > 3:
                                    print(f"  ... și încă {len(queues) - 3} cozi")
                        else:
                            print(f"\n[{evt}] {json.dumps(data)[:200]}")
                    except json.JSONDecodeError:
                        print(f"\n[raw] {msg[:200]}")

                print(f"\n\nTotal snapshot-uri primite în 20s: {snapshot_count} (așteptat: >=2 – unul imediat, unul după ~15s)")
                if snapshot_count == 0:
                    print("Niciun snapshot – fie backend nu trimite, fie proxy-ul nu transmite WebSocket corect.")
                    sys.exit(1)
        except websockets.exceptions.InvalidStatusCode as e:
            print(f"Eroare HTTP: {e.status_code}")
            if e.status_code == 401:
                print("401 Unauthorized – setează SESSION_TOKEN (token din browser sau din /api/session/token).")
            sys.exit(1)
        except Exception as e:
            print(f"Eroare: {e}")
            sys.exit(1)

    asyncio.run(run())


if __name__ == "__main__":
    main()
