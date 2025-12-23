#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Reservoir:
    seen: int
    items: List[Dict[str, Any]]  # each item: {"id": str, "product": dict}


def normalize_vendor(vendor: Any) -> str:
    if vendor is None:
        return "(null)"
    if isinstance(vendor, str):
        v = vendor.strip()
        return v if v else "(empty)"
    return str(vendor)


def iter_jsonl(path: str):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                yield line_no, json.loads(line)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"Invalid JSON on line {line_no}: {e}") from e


def is_variant(obj: Dict[str, Any]) -> bool:
    return "__parentId" in obj


def is_product(obj: Dict[str, Any]) -> bool:
    # Bulk exports typically emit Product and ProductVariant (and potentially others)
    return ("vendor" in obj) and ("id" in obj) and (not is_variant(obj))


def reservoir_update(res: Reservoir, item: Dict[str, Any], k: int, rng: random.Random) -> None:
    res.seen += 1
    if len(res.items) < k:
        res.items.append(item)
        return

    j = rng.randrange(res.seen)
    if j < k:
        res.items[j] = item


def _vendor_bucket(vendor: str) -> str:
    v = (vendor or "").strip()
    if not v:
        return "#"
    ch = v[0].upper()
    if "A" <= ch <= "Z":
        return ch
    return "#"


def pick_vendors_alphabet_first(vendors_sorted: List[str], alphabet: str) -> List[str]:
    """Pick the first vendor for each bucket letter in `alphabet`.

    Convention: `alphabet` can include a final '#' bucket for non A-Z initials.
    """
    by_bucket: Dict[str, List[str]] = defaultdict(list)
    for v in vendors_sorted:
        by_bucket[_vendor_bucket(v)].append(v)

    picked: List[str] = []
    for bucket in alphabet:
        if bucket in by_bucket and by_bucket[bucket]:
            picked.append(by_bucket[bucket][0])
    return picked


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Count unique vendors in a Shopify bulk JSONL and sample K random products per vendor (with their variants)."
    )
    parser.add_argument("jsonl", help="Path to bulk JSONL (e.g., bulk-products.jsonl)")
    parser.add_argument("--k", type=int, default=3, help="Products to sample per vendor (default: 3)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed (optional)")
    parser.add_argument(
        "--alphabet-pick",
        action="store_true",
        help="Deterministic mode: sort vendors and pick the first vendor for each letter in --alphabet (27 buckets).",
    )
    parser.add_argument(
        "--alphabet",
        default="ABCDEFGHIJKLMNOPQRSTUVWXYZ#",
        help="Alphabet buckets used with --alphabet-pick (default: ABCDEFGHIJKLMNOPQRSTUVWXYZ#)",
    )
    parser.add_argument(
        "--out",
        default="Research Produse/Outputs/vendor_samples_report.json",
        help="Output JSON report path (default: Research Produse/Outputs/vendor_samples_report.json)",
    )
    args = parser.parse_args()

    if args.k <= 0:
        raise SystemExit("--k must be >= 1")

    seed = args.seed
    if seed is None:
        env_seed = os.getenv("SAMPLE_SEED")
        seed = int(env_seed) if env_seed else None

    vendor_product_counts: Dict[str, int] = defaultdict(int)

    # Pass 1: count vendors
    for _line_no, obj in iter_jsonl(args.jsonl):
        if not isinstance(obj, dict):
            continue
        if not is_product(obj):
            continue
        vendor = normalize_vendor(obj.get("vendor"))
        vendor_product_counts[vendor] += 1

    vendors = sorted(vendor_product_counts.keys())

    # Choose which vendors to include
    selected_vendors: Optional[List[str]] = None
    if args.alphabet_pick:
        alphabet = (args.alphabet or "").strip() or "ABCDEFGHIJKLMNOPQRSTUVWXYZ#"
        selected_vendors = pick_vendors_alphabet_first(vendors, alphabet)

    # Pass 2: collect selected products (either reservoir-sampled per vendor, or deterministic first-K)
    reservoirs: Dict[str, Reservoir] = {}
    sampled_by_vendor: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    selected_product_ids = set()

    rng = random.Random(seed)

    selected_vendor_set = set(selected_vendors) if selected_vendors is not None else None

    for line_no, obj in iter_jsonl(args.jsonl):
        if not isinstance(obj, dict):
            continue
        if not is_product(obj):
            continue

        vendor = normalize_vendor(obj.get("vendor"))
        if selected_vendor_set is not None and vendor not in selected_vendor_set:
            continue

        pid = obj.get("id")
        if not pid:
            continue

        if args.alphabet_pick:
            # Deterministic: first K products per vendor in file order.
            if len(sampled_by_vendor[vendor]) >= args.k:
                continue
            sampled_by_vendor[vendor].append({"id": pid, "product": obj, "line": line_no})
            selected_product_ids.add(pid)
        else:
            # Random: reservoir sampling per vendor.
            if vendor not in reservoirs:
                reservoirs[vendor] = Reservoir(seen=0, items=[])
            reservoir_update(
                reservoirs[vendor],
                {"id": pid, "product": obj, "line": line_no},
                args.k,
                rng,
            )

    if not args.alphabet_pick:
        selected_product_ids = set()
        for vendor in vendors:
            for item in reservoirs.get(vendor, Reservoir(seen=0, items=[])).items:
                if item.get("id"):
                    selected_product_ids.add(item["id"])

    # Pass 3: collect full product + variants for selected products
    products_by_id: Dict[str, Dict[str, Any]] = {}
    variants_by_parent: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for _line_no, obj in iter_jsonl(args.jsonl):
        if not isinstance(obj, dict):
            continue

        if is_variant(obj):
            parent = obj.get("__parentId")
            if parent in selected_product_ids:
                variants_by_parent[parent].append(obj)
            continue

        pid = obj.get("id")
        if pid in selected_product_ids and is_product(obj):
            products_by_id[pid] = obj

    # Build output structure
    report: Dict[str, Any] = {
        "source": os.path.abspath(args.jsonl),
        "seed": seed,
        "k": args.k,
        "vendorCount": len(vendors),
        "mode": "alphabet_pick" if args.alphabet_pick else "reservoir",
        "alphabet": args.alphabet if args.alphabet_pick else None,
        "selectedVendorCount": len(selected_vendors) if selected_vendors is not None else len(vendors),
        "vendors": [],
    }

    vendors_to_emit = selected_vendors if selected_vendors is not None else vendors

    for vendor in vendors_to_emit:
        sampled = sampled_by_vendor[vendor] if args.alphabet_pick else reservoirs.get(vendor, Reservoir(seen=0, items=[])).items
        vendor_entry = {
            "vendor": vendor,
            "productCountInFile": vendor_product_counts[vendor],
            "sampled": [],
        }

        for item in sampled:
            pid = item.get("id")
            product = products_by_id.get(pid)
            vendor_entry["sampled"].append(
                {
                    "productId": pid,
                    "productLine": item.get("line"),
                    "product": product,
                    "variants": variants_by_parent.get(pid, []),
                }
            )

        report["vendors"].append(vendor_entry)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Console summary
    print(f"Vendors (unique): {len(vendors)}")
    print(f"Report written: {args.out}")
    # Print top 20 vendors by product count for a quick sanity check
    top = sorted(vendor_product_counts.items(), key=lambda kv: kv[1], reverse=True)[:20]
    print("Top vendors by product count (up to 20):")
    for v, cnt in top:
        print(f"  - {v}: {cnt}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        # allow piping to head without stacktrace
        raise SystemExit(0)
