#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import List, Sequence, Tuple


def run_psql(sql: str) -> str:
    connection_url = os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL")
    command = ["psql"]
    if connection_url:
        parsed = urllib.parse.urlparse(connection_url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise RuntimeError("Invalid MIGRATION_DATABASE_URL/DATABASE_URL scheme")
        command.append(connection_url)
    command.extend(["-v", "ON_ERROR_STOP=1", "-At", "-F", "\t"])
    proc = subprocess.run(
        command,
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql failed")
    return proc.stdout


def fetch_rows(limit: int) -> List[Tuple[str, str]]:
    sql = f"""
    SELECT e.id::text,
           trim(concat_ws(' ',
             pm.canonical_title,
             coalesce(pm.brand, ''),
             coalesce(pm.manufacturer, ''),
             coalesce(pm.mpn, '')
           ))
      FROM prod_embeddings e
      JOIN prod_master pm ON pm.id = e.product_id
     WHERE e.embedding_type = 'combined'
       AND e.model_version <> 'qwen3-embedding-8b-q5km'
     ORDER BY e.id
     LIMIT {limit}
    """
    rows: List[Tuple[str, str]] = []
    for line in run_psql(sql).splitlines():
        if not line.strip():
            continue
        row_id, text = line.split("\t", 1)
        rows.append((row_id, text))
    return rows


def embed_batch(endpoint: str, model: str, texts: Sequence[str]) -> List[List[float]]:
    payload = json.dumps(
        {"model": model, "input": list(texts), "dimensions": 2000}, ensure_ascii=True
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    parsed = json.loads(body.decode("utf-8"))
    data = parsed.get("data") or []
    vectors: List[List[float]] = []
    for item in data:
        vec = item.get("embedding")
        if not isinstance(vec, list):
            raise RuntimeError("invalid embedding response")
        vectors.append([float(v) for v in vec])
    if len(vectors) != len(texts):
        raise RuntimeError("embedding count mismatch")
    return vectors


def l2_normalize(vec: Sequence[float]) -> List[float]:
    norm = sum(v * v for v in vec) ** 0.5
    if norm <= 0:
        return list(vec)
    if abs(norm - 1.0) <= 0.001:
        return list(vec)
    return [v / norm for v in vec]


def update_rows(rows: Sequence[Tuple[str, Sequence[float]]], model_version: str) -> None:
    values: List[str] = []
    for row_id, vec in rows:
        normalized = l2_normalize(vec)
        literal = "[" + ",".join(f"{v:.9f}" for v in normalized) + "]"
        values.append(f"('{row_id}', '{literal}')")

    sql = f"""
    UPDATE prod_embeddings e
       SET embedding = v.embedding::vector(2000),
           model_version = '{model_version}',
           updated_at = now()
      FROM (VALUES {",".join(values)}) AS v(id, embedding)
     WHERE e.id = v.id::uuid
    """
    run_psql(sql)


def remaining() -> int:
    out = run_psql(
        "SELECT COUNT(*)::text FROM prod_embeddings WHERE embedding_type='combined' AND model_version <> 'qwen3-embedding-8b-q5km'"
    ).strip()
    return int(out or "0")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://10.0.1.10:49003/v1/embeddings")
    parser.add_argument("--model", default="qwen3-embedding-8b-q5km")
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    total = 0
    while True:
        rows = fetch_rows(args.batch_size)
        if not rows:
            break
        ids = [r[0] for r in rows]
        texts = [r[1] for r in rows]
        vectors = embed_batch(args.endpoint, args.model, texts)
        update_rows(list(zip(ids, vectors, strict=True)), args.model)
        total += len(rows)
        print(f"processed={total} remaining={remaining()}", flush=True)

    print("prod_embeddings re-embedding completed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
