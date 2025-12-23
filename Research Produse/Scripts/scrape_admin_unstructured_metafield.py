#!/usr/bin/env python3
"""Scrape an "unstructured" product metafield from Shopify Admin UI.

Why this exists:
- Some metafields (notably app-owned namespaces like `app--<appId>--...`) are not readable via the Admin API token
  of a different app.
- The Shopify Admin UI, when viewed by a staff/admin user, may still show these metafields.

Important:
- This uses browser automation against Shopify Admin UI and relies on internal Admin behavior.
- It is *not* an official Shopify Admin API method and may break at any time.

Typical flow:
1) First run (interactive login), save a storage state:
   python3 Research Produse/Scripts/scrape_admin_unstructured_metafield.py \
     --store-handle d366ab \
     --product-id 8628341506315 \
     --namespace app--3890849--eligibility \
     --key eligibility_details \
     --storage-state Research Produse/Outputs/admin_storage_state.json \
     --headful

2) Next runs (reuse login session, can be headless):
   python3 Research Produse/Scripts/scrape_admin_unstructured_metafield.py \
     --store-handle d366ab \
     --product-id 8628341506315 \
     --namespace app--3890849--eligibility \
     --key eligibility_details \
     --storage-state Research Produse/Outputs/admin_storage_state.json

Install deps (once):
  python3 -m pip install --upgrade playwright
  python3 -m playwright install chromium

On headless servers, you may need:
  sudo apt-get install -y xvfb
  xvfb-run -a python3 ... --headful
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class FoundMetafield:
    namespace: str
    key: str
    value: Optional[str]
    json_value: Any
    source_url: str


def _deep_find_metafields(obj: Any, namespace: str, key: str, source_url: str, out: List[FoundMetafield]) -> None:
    if isinstance(obj, dict):
        ns = obj.get("namespace")
        k = obj.get("key")
        if ns == namespace and k == key:
            out.append(
                FoundMetafield(
                    namespace=namespace,
                    key=key,
                    value=obj.get("value"),
                    json_value=obj.get("jsonValue"),
                    source_url=source_url,
                )
            )
        for v in obj.values():
            _deep_find_metafields(v, namespace, key, source_url, out)
    elif isinstance(obj, list):
        for v in obj:
            _deep_find_metafields(v, namespace, key, source_url, out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape an unstructured Shopify Admin metafield via browser automation.")
    parser.add_argument("--store-handle", required=True, help="Shopify store handle as used in admin.shopify.com/store/<handle>")
    parser.add_argument("--product-id", required=True, help="Numeric product id (legacyResourceId), e.g. 8628341506315")
    parser.add_argument("--namespace", required=True, help="Metafield namespace (e.g. app--3890849--eligibility)")
    parser.add_argument("--key", required=True, help="Metafield key (e.g. eligibility_details)")
    parser.add_argument(
        "--storage-state",
        default="",
        help="Path to a Playwright storage state JSON file (created after login, reused on later runs)",
    )
    parser.add_argument("--headful", action="store_true", help="Run browser with UI (recommended for first login)")
    parser.add_argument("--timeout-seconds", type=int, default=45, help="Overall wait timeout")

    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print("Playwright is not installed. Run: python3 -m pip install --upgrade playwright", file=sys.stderr)
        raise

    target_url = (
        f"https://admin.shopify.com/store/{args.store_handle}/products/{args.product_id}/metafields/unstructured"
    )

    found: List[FoundMetafield] = []

    storage_state_path = args.storage_state.strip() or None
    if storage_state_path and os.path.exists(storage_state_path):
        use_storage_state = storage_state_path
    else:
        use_storage_state = None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=(not args.headful))

        context_kwargs: Dict[str, Any] = {}
        if use_storage_state:
            context_kwargs["storage_state"] = use_storage_state

        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        def on_response(resp) -> None:
            try:
                ct = (resp.headers or {}).get("content-type", "")
                if "application/json" not in ct and "graphql" not in resp.url:
                    return
                data = resp.json()
            except Exception:
                return

            _deep_find_metafields(data, args.namespace, args.key, resp.url, found)

        page.on("response", on_response)

        page.goto(target_url, wait_until="domcontentloaded")

        if not use_storage_state:
            if not args.headful:
                print(
                    "No storage state provided/found. Re-run with --headful to login once and save --storage-state.",
                    file=sys.stderr,
                )
                browser.close()
                return 2

            print("If prompted, login in the opened browser window.")
            print("When you can see the product metafields page, press Enter here to continue...")
            try:
                input()
            except KeyboardInterrupt:
                browser.close()
                return 130

        # Give the admin UI some time to load and fire GraphQL/XHR responses
        deadline = time.time() + float(args.timeout_seconds)
        while time.time() < deadline and not found:
            page.wait_for_timeout(500)

        # Try to persist session for next runs
        if storage_state_path and not use_storage_state:
            try:
                os.makedirs(os.path.dirname(storage_state_path), exist_ok=True)
                context.storage_state(path=storage_state_path)
                print(f"Saved storage state to: {storage_state_path}")
            except Exception as e:
                print(f"Warning: failed to save storage state: {e}", file=sys.stderr)

        browser.close()

    # Deduplicate by (namespace,key,value,json_value)
    unique: Dict[Tuple[str, str, Optional[str], str], FoundMetafield] = {}
    for item in found:
        unique_key = (item.namespace, item.key, item.value, json.dumps(item.json_value, sort_keys=True, ensure_ascii=False))
        unique[unique_key] = item

    results = list(unique.values())

    if not results:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "Metafield not found in captured Admin responses.",
                    "target": {
                        "url": target_url,
                        "namespace": args.namespace,
                        "key": args.key,
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    # Print structured output
    payload = {
        "ok": True,
        "target": {"url": target_url, "namespace": args.namespace, "key": args.key},
        "matches": [
            {
                "namespace": r.namespace,
                "key": r.key,
                "value": r.value,
                "jsonValue": r.json_value,
                "sourceUrl": r.source_url,
            }
            for r in results
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
