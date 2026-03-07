#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import random
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


def sample_taxonomy(sample_size: int, model_version: str) -> List[Tuple[str, str]]:
    sql = f"""
    SELECT id::text,
           trim(concat_ws(' ', name, array_to_string(breadcrumbs, ' ')))
      FROM prod_taxonomy
     WHERE is_active = true
       AND embedding IS NOT NULL
       AND model_version = '{model_version}'
     ORDER BY id
    """
    rows: List[Tuple[str, str]] = []
    for line in run_psql(sql).splitlines():
        if not line.strip():
            continue
        taxonomy_id, text = line.split("\t", 1)
        rows.append((taxonomy_id, text))
    if len(rows) < sample_size:
        raise RuntimeError(f"Not enough rows for sample: {len(rows)} < {sample_size}")
    random.seed(42)
    return random.sample(rows, sample_size)


def embed(endpoint: str, model: str, text: str, dimensions: int) -> List[float]:
    payload = json.dumps(
        {"model": model, "input": text, "dimensions": dimensions}, ensure_ascii=True
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
    if not data or not isinstance(data[0], dict) or not isinstance(data[0].get("embedding"), list):
        raise RuntimeError("Invalid embedding response")
    return [float(v) for v in data[0]["embedding"]]


def top5_ids(vector: Sequence[float], model_version: str) -> List[str]:
    vec = "[" + ",".join(f"{v:.9f}" for v in vector) + "]"
    sql = f"""
    SELECT id::text
      FROM prod_taxonomy
     WHERE is_active = true
       AND embedding IS NOT NULL
       AND model_version = '{model_version}'
     ORDER BY embedding <=> '{vec}'::vector(2000)
     LIMIT 5
    """
    return [line.strip() for line in run_psql(sql).splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://10.0.1.10:49003/v1/embeddings")
    parser.add_argument("--model", default="qwen3-embedding-8b-q5km")
    parser.add_argument("--model-version", default="qwen3-embedding-8b-q5km")
    parser.add_argument("--sample-size", type=int, default=50)
    parser.add_argument("--threshold", type=float, default=0.80)
    args = parser.parse_args()

    samples = sample_taxonomy(args.sample_size, args.model_version)
    hits = 0
    for taxonomy_id, text in samples:
        vector = embed(args.endpoint, args.model, text, 2000)
        top_ids = top5_ids(vector, args.model_version)
        if taxonomy_id in top_ids:
            hits += 1

    recall = hits / len(samples)
    print(f"recall_at_5={recall:.4f} hits={hits} sample={len(samples)}")
    if recall < args.threshold:
        print("QUALITY_GATE_FAILED", file=sys.stderr)
        return 1
    print("QUALITY_GATE_PASSED")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
