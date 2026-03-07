#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
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
        raise RuntimeError(proc.stderr.strip() or "psql command failed")
    return proc.stdout


def fetch_batch(limit: int) -> List[Tuple[str, str]]:
    sql = f"""
    SELECT id::text,
           trim(concat_ws(' ', name, array_to_string(breadcrumbs, ' ')))
    FROM prod_taxonomy
    WHERE is_active = true
      AND embedding IS NULL
    ORDER BY id
    LIMIT {limit}
    """
    rows: List[Tuple[str, str]] = []
    for line in run_psql(sql).splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        rows.append((parts[0], parts[1]))
    return rows


def embed(endpoint: str, model: str, texts: Sequence[str], dimensions: int) -> List[List[float]]:
    payload = json.dumps(
        {"model": model, "input": list(texts), "dimensions": dimensions}, ensure_ascii=True
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
    embeddings: List[List[float]] = []
    for item in data:
        vec = item.get("embedding")
        if not isinstance(vec, list):
            raise RuntimeError("Invalid embedding payload")
        embeddings.append([float(v) for v in vec])
    if len(embeddings) != len(texts):
        raise RuntimeError(f"Embedding size mismatch: {len(embeddings)} != {len(texts)}")
    return embeddings


def l2_normalize(vec: Sequence[float]) -> List[float]:
    norm = sum(v * v for v in vec) ** 0.5
    if norm <= 0:
        return list(vec)
    if abs(norm - 1.0) <= 0.001:
        return list(vec)
    return [v / norm for v in vec]


def update_rows(rows: Sequence[Tuple[str, Sequence[float]]], model: str) -> None:
    values_sql: List[str] = []
    for taxonomy_id, embedding in rows:
        normalized = l2_normalize(embedding)
        vector_literal = "[" + ",".join(f"{v:.9f}" for v in normalized) + "]"
        values_sql.append(f"('{taxonomy_id}', '{vector_literal}')")

    sql = f"""
    UPDATE prod_taxonomy AS t
       SET embedding = v.embedding::vector(2000),
           model_version = '{model}',
           updated_at = now()
      FROM (VALUES {",".join(values_sql)}) AS v(id, embedding)
     WHERE t.id = v.id::uuid
    """
    run_psql(sql)


def count_remaining() -> int:
    out = run_psql(
        "SELECT COUNT(*)::text FROM prod_taxonomy WHERE is_active = true AND embedding IS NULL"
    ).strip()
    return int(out or "0")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://10.0.1.10:49003/v1/embeddings")
    parser.add_argument("--model", default="qwen3-embedding-8b-q5km")
    parser.add_argument("--dimensions", type=int, default=2000)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()

    total_done = 0
    started = time.time()

    while True:
        batch = fetch_batch(args.batch_size)
        if not batch:
            break
        ids = [row[0] for row in batch]
        texts = [row[1] for row in batch]
        vectors = embed(args.endpoint, args.model, texts, args.dimensions)
        update_rows(list(zip(ids, vectors, strict=True)), args.model)
        total_done += len(batch)
        remaining = count_remaining()
        elapsed = time.time() - started
        print(
            f"processed={total_done} remaining={remaining} elapsed_s={elapsed:.1f}",
            flush=True,
        )

    print("taxonomy re-embedding completed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
