#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


INTROSPECT_TYPE_QUERY = r'''
query IntrospectType($name: String!) {
  __type(name: $name) {
  kind
  name
  fields {
    name
    args {
    name
    defaultValue
    type {
      kind
      name
      ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
        kind
        name
        }
      }
      }
    }
    }
    type {
    kind
    name
    ofType {
      kind
      name
      ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
        kind
        name
        }
      }
      }
    }
    }
  }
  }
}
'''


def _unwrap_type(t: Dict[str, Any]) -> Tuple[str, Optional[str], bool]:
  """Return (base_kind, base_name, is_list)."""
  is_list = False
  cur = t
  while cur and cur.get("kind") in ("NON_NULL", "LIST"):
    if cur.get("kind") == "LIST":
      is_list = True
    cur = cur.get("ofType") or {}
  return (cur.get("kind") or "", cur.get("name"), is_list)


def _has_required_args(args: List[Dict[str, Any]]) -> bool:
  for a in args or []:
    # In GraphQL, a NON_NULL arg without a default is required
    if (a.get("type") or {}).get("kind") == "NON_NULL" and a.get("defaultValue") is None:
      return True
  return False


def _is_connection_type_name(type_name: Optional[str]) -> bool:
  return bool(type_name) and type_name.endswith("Connection")


def _safe_field_name(name: str) -> bool:
  # Avoid introspection-related names or weird internal fields
  return name and not name.startswith("__")


def _pick_object_scalar_fields(type_info: Dict[str, Any], max_fields: int = 40) -> List[Dict[str, Any]]:
  fields = (type_info.get("fields") or [])
  picked: List[Dict[str, Any]] = []

  # Prefer id/__typename first (if present)
  for f in fields:
    if f.get("name") == "id":
      picked.append(f)
      break

  for f in fields:
    n = f.get("name")
    if not _safe_field_name(n):
      continue
    if n == "id":
      continue
    kind, _, _ = _unwrap_type(f.get("type") or {})
    if kind in ("SCALAR", "ENUM") and not (f.get("args") or []):
      picked.append(f)
    if len(picked) >= max_fields:
      break
  return picked


def build_everything_product_query(
  endpoint: str,
  token: str,
  max_depth: int = 2,
  connection_first: int = 50,
  connection_max_fields: int = 25,
  skip_fields: Optional[List[str]] = None,
) -> Tuple[str, Dict[str, Any]]:
  """Build a best-effort Product selection set using schema introspection.

  Returns (query, meta) where meta includes skipped fields.
  """
  cache: Dict[str, Dict[str, Any]] = {}
  skipped: List[Dict[str, Any]] = []

  # These fields have been observed to error in some shops/apps (e.g., app has no publication),
  # and when they are NON_NULL in the schema they can null the entire `product` object.
  default_skip = {
    "publishedOnCurrentPublication",
  }
  if skip_fields:
    default_skip.update({s.strip() for s in skip_fields if s and s.strip()})

  def get_type(name: str) -> Dict[str, Any]:
    if name in cache:
      return cache[name]
    resp = gql_post(endpoint, token, INTROSPECT_TYPE_QUERY, variables={"name": name}, timeout=60)
    t = (resp.get("data") or {}).get("__type") or {}
    cache[name] = t
    return t

  def build_selection_for_type(type_name: str, depth: int, visited: List[str]) -> str:
    if depth > max_depth:
      return "id __typename"
    if type_name in visited:
      return "id __typename"

    t = get_type(type_name) or {}
    if not t.get("name"):
      return "__typename"

    # Special-cases for common money/image-ish objects to get meaningful data
    if type_name == "MoneyV2":
      return "amount currencyCode"
    if type_name == "SEO":
      return "title description"
    if type_name in ("Image", "ImageSource"):
      return "id url altText width height"

    picked = _pick_object_scalar_fields(t, max_fields=connection_max_fields)
    out_parts: List[str] = []
    # Always include __typename to disambiguate unions/interfaces when embedded
    out_parts.append("__typename")

    for f in picked:
      n = f.get("name")
      if n and n not in out_parts:
        if n in default_skip:
          continue
        out_parts.append(n)

    return "\n".join(out_parts)

  product_type = get_type("Product")
  product_fields = product_type.get("fields") or []

  selection_lines: List[str] = ["id", "__typename"]

  for f in product_fields:
    fname = f.get("name")
    if not _safe_field_name(fname):
      continue

    if fname in default_skip:
      skipped.append({"field": fname, "reason": "skip_list"})
      continue

    args = f.get("args") or []
    if _has_required_args(args):
      skipped.append({"field": fname, "reason": "requires_args"})
      continue

    kind, base_name, is_list = _unwrap_type(f.get("type") or {})

    # Scalars/enums: include directly
    if kind in ("SCALAR", "ENUM"):
      selection_lines.append(fname)
      continue

    # Objects: either connection or nested object
    if kind == "OBJECT" and _is_connection_type_name(base_name):
      # Connection: try to include nodes + pageInfo
      conn_type = get_type(base_name) if base_name else {}
      # Determine node type by introspecting Connection.nodes
      node_type_name: Optional[str] = None
      for cf in conn_type.get("fields") or []:
        if cf.get("name") == "nodes":
          nk, nn, _ = _unwrap_type(cf.get("type") or {})
          if nk == "OBJECT" and nn:
            node_type_name = nn
          elif nk in ("INTERFACE", "UNION"):
            node_type_name = nn
          break

      # Prefer using first/after if available
      arg_names = {a.get("name") for a in args}
      arg_str = ""
      if "first" in arg_names:
        arg_str = f"(first: {connection_first})"

      node_sel = "id __typename"
      if node_type_name:
        # For object nodes, include scalar fields for that node type
        nt = get_type(node_type_name) or {}
        if (nt.get("kind") or "") == "OBJECT":
          node_sel = build_selection_for_type(node_type_name, depth=1, visited=["Product"])
        else:
          node_sel = "id __typename"

      selection_lines.append(
        f"{fname}{arg_str} {{\n  nodes {{\n    {node_sel.replace(chr(10), chr(10)+'    ')}\n  }}\n  pageInfo {{ hasNextPage endCursor }}\n}}"
      )
      continue

    if kind == "OBJECT" and base_name:
      # Nested object: include scalar/enum fields of that object (one level)
      nested_sel = build_selection_for_type(base_name, depth=1, visited=["Product"])
      selection_lines.append(
        f"{fname} {{\n  {nested_sel.replace(chr(10), chr(10)+'  ')}\n}}"
      )
      continue

    # Interfaces/unions: include minimal selection (typename only)
    if kind in ("INTERFACE", "UNION"):
      selection_lines.append(f"{fname} {{ __typename }}")
      continue

    skipped.append({"field": fname, "reason": f"unsupported_kind:{kind}"})

  query = "query ProductEverything($id: ID!) {\n  product(id: $id) {\n    " + "\n    ".join(selection_lines) + "\n  }\n}"

  meta = {
    "maxDepth": max_depth,
    "connectionFirst": connection_first,
    "connectionMaxFields": connection_max_fields,
    "skipped": skipped,
    "introspectedTypes": sorted(cache.keys()),
  }
  return query, meta


def load_env_file(path: str) -> Dict[str, str]:
    env: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            # strip inline comments for values that are not quoted
            if " #" in v:
                v = v.split(" #", 1)[0].rstrip()
            if v.startswith('"') and v.endswith('"') and len(v) >= 2:
                v = v[1:-1]
            env[k] = v
    return env


def gql_post(endpoint: str, token: str, query: str, variables: Optional[Dict[str, Any]] = None, timeout: int = 60) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"query": query}
    if variables is not None:
        payload["variables"] = variables

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return json.loads(body)


def pick_test_set(report: Dict[str, Any], vendor_count: int, seed: int, pick_mode: str = "random") -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    vendors = report.get("vendors") or []
    if not vendors:
        raise RuntimeError("vendor_samples_report.json has no vendors")

    # Only vendors that have at least 1 sampled product
    eligible = [v for v in vendors if (v.get("sampled") or [])]
    if len(eligible) < vendor_count:
        vendor_count = len(eligible)

    if pick_mode == "report-order":
        chosen_vendors = eligible[:vendor_count]
    else:
        chosen_vendors = rng.sample(eligible, vendor_count)

    picked: List[Dict[str, Any]] = []
    for v in chosen_vendors:
        sampled = v.get("sampled") or []
        # Ensure deterministic ordering per vendor for stable output
        sampled = list(sampled)
        # If a vendor has >3 sampled in report (shouldn't), take first 3
        sampled = sampled[:3]
        picked.append({"vendor": v.get("vendor"), "sampled": sampled, "productCountInFile": v.get("productCountInFile")})

    # Sort by vendor name for readability + stable diffing
    picked.sort(key=lambda x: (x.get("vendor") or ""))
    return picked


PRODUCT_FIELDS_INTROSPECTION = r'''
query ProductFields {
  __type(name: "Product") {
    name
    fields {
      name
      args {
        name
        defaultValue
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
      type {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
}
'''


PRODUCT_DETAILS_QUERY = r'''
query ProductDetails($id: ID!) {
  product(id: $id) {
    id
    legacyResourceId
    title
    handle
    status
    vendor
    productType
    description
    descriptionHtml
    createdAt
    updatedAt
    publishedAt
    templateSuffix
    tags
    hasOnlyDefaultVariant
    totalInventory

    seo {
      title
      description
    }

    options {
      id
      name
      values
    }

    featuredImage {
      id
      url
      altText
      width
      height
    }

    priceRangeV2 {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }

    compareAtPriceRange {
      minVariantCompareAtPrice { amount currencyCode }
      maxVariantCompareAtPrice { amount currencyCode }
    }

    images(first: 10) {
      nodes {
        id
        url
        altText
        width
        height
      }
    }

    media(first: 10) {
      nodes {
        __typename
        ... on MediaImage {
          id
          image { id url altText width height }
        }
        ... on Video {
          id
          sources { url mimeType format height width }
        }
        ... on ExternalVideo {
          id
          embeddedUrl
          host
        }
        ... on Model3d {
          id
          sources { url mimeType format filesize }
        }
      }
    }

    collections(first: 10) {
      nodes {
        id
        handle
        title
        updatedAt
      }
    }

    metafields(first: 250) {
      nodes {
        id
        namespace
        key
        type
        value
        jsonValue
        createdAt
        updatedAt
        ownerType
        definition {
          id
          name
          namespace
          key
          type {
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }

    variants(first: 100) {
      nodes {
        id
        legacyResourceId
        title
        sku
        barcode
        price
        compareAtPrice
        taxable
        inventoryQuantity
        availableForSale
        inventoryPolicy
        requiresComponents
        unitPrice { amount currencyCode }
        unitPriceMeasurement {
          measuredType
          quantityUnit
          quantityValue
          referenceUnit
          referenceValue
        }

        selectedOptions { name value }

        image { id url altText width height }

        inventoryItem {
          id
          tracked
          unitCost { amount currencyCode }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
'''


PRODUCT_METAFIELDS_PAGE_QUERY = r'''
query ProductMetafieldsPage($id: ID!, $after: String) {
  product(id: $id) {
    metafields(first: 250, after: $after) {
      nodes {
        id
        namespace
        key
        type
        value
        jsonValue
        createdAt
        updatedAt
        ownerType
        definition {
          id
          name
          namespace
          key
          type { name }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
'''


PRODUCT_VARIANTS_PAGE_QUERY = r'''
query ProductVariantsPage($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      nodes {
        id
        legacyResourceId
        title
        sku
        barcode
        price
        compareAtPrice
        taxable
        inventoryQuantity
        availableForSale
        inventoryPolicy
        requiresComponents
        unitPrice { amount currencyCode }
        unitPriceMeasurement {
          measuredType
          quantityUnit
          quantityValue
          referenceUnit
          referenceValue
        }

        selectedOptions { name value }

        image { id url altText width height }

        inventoryItem {
          id
          tracked
          unitCost { amount currencyCode }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
'''


def main() -> int:
  ap = argparse.ArgumentParser(
    description="Fetch Shopify product details for 10 test vendors x 3 products each via Admin GraphQL (CLI can't fetch API objects)."
  )
  ap.add_argument("--env", default="../../.env", help="Env file path (default: ../../.env)")
  ap.add_argument(
    "--report",
    default="Research Produse/Outputs/vendor_samples_report.json",
    help="Input report from JSONL sampling (default: Research Produse/Outputs/vendor_samples_report.json)",
  )
  ap.add_argument("--api-version", default="2025-10", help="Shopify Admin API version")
  ap.add_argument("--vendor-count", type=int, default=10, help="How many vendors to test")
  ap.add_argument("--seed", type=int, default=20251222, help="Random seed for choosing vendors")
  ap.add_argument(
    "--vendor-pick-mode",
    choices=["random", "report-order"],
    default="random",
    help="How to choose vendors from the report: random sample (default) or deterministic report order.",
  )
  ap.add_argument(
    "--out-details",
    default="Research Produse/Outputs/test_vendors_products_details.json",
    help="Output file with fetched product details (default: Research Produse/Outputs/test_vendors_products_details.json)",
  )
  ap.add_argument(
    "--out-schema",
    default="Research Produse/Outputs/product_type_fields.json",
    help="Output file with Product type fields (introspection) (default: Research Produse/Outputs/product_type_fields.json)",
  )
  ap.add_argument(
    "--out-everything-query",
    default="",
    help="If set, writes the generated --everything GraphQL query to this path (debug/research).",
  )
  ap.add_argument(
    "--everything",
    action="store_true",
    help="Best-effort fetch: attempt to read every queryable Product field via schema-driven query generation (research mode).",
  )
  ap.add_argument(
    "--everything-max-depth",
    type=int,
    default=2,
    help="Max nesting depth for object sub-selections in --everything mode (default: 2)",
  )
  ap.add_argument(
    "--everything-connection-first",
    type=int,
    default=50,
    help="Page size for Product connection fields in --everything mode (default: 50)",
  )
  ap.add_argument(
    "--everything-connection-max-fields",
    type=int,
    default=25,
    help="How many scalar fields to include for nested objects/nodes in --everything mode (default: 25)",
  )
  ap.add_argument(
    "--everything-skip-fields",
    default="",
    help="Comma-separated Product field names to skip in --everything mode (e.g. publishedOnCurrentPublication)",
  )
  ap.add_argument(
    "--paginate-variants",
    action="store_true",
    help="Paginate variants beyond first 100 (safe; adds extra API calls per product).",
  )
  ap.add_argument(
    "--paginate-variants-max-pages",
    type=int,
    default=10,
    help="Safety cap for variants pagination pages (default: 10).",
  )
  ap.add_argument(
    "--paginate-variants-sleep",
    type=float,
    default=0.02,
    help="Sleep seconds between variants page requests (default: 0.02).",
  )
  args = ap.parse_args()

  env = load_env_file(args.env)
  shop = env.get("SHOPIFY_SHOP_DOMAIN")
  token = env.get("SHOPIFY_ADMIN_API_TOKEN")

  if not shop or not token:
    raise SystemExit("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN in env file")

  endpoint = f"https://{shop}/admin/api/{args.api_version}/graphql.json"

  with open(args.report, "r", encoding="utf-8") as f:
    report = json.load(f)

  picked = pick_test_set(report, vendor_count=args.vendor_count, seed=args.seed, pick_mode=args.vendor_pick_mode)

  # 1) Introspection: list all Product fields
  schema_resp = gql_post(endpoint, token, PRODUCT_FIELDS_INTROSPECTION, variables=None, timeout=60)
  if schema_resp.get("errors"):
    raise RuntimeError(f"Introspection errors: {schema_resp['errors']}")

  with open(args.out_schema, "w", encoding="utf-8") as f:
    json.dump(schema_resp.get("data", {}), f, ensure_ascii=False, indent=2)

  # 2) Fetch details for products
  out: Dict[str, Any] = {
    "shop": shop,
    "apiVersion": args.api_version,
    "seed": args.seed,
    "vendorCount": len(picked),
    "vendors": [],
  }

  # Build dynamic query for --everything mode
  everything_query = None
  everything_meta: Dict[str, Any] = {}
  if args.everything:
    try:
      skip_fields = [s.strip() for s in (args.everything_skip_fields or "").split(",") if s.strip()]
      everything_query, everything_meta = build_everything_product_query(
        endpoint,
        token,
        max_depth=args.everything_max_depth,
        connection_first=args.everything_connection_first,
        connection_max_fields=args.everything_connection_max_fields,
        skip_fields=skip_fields,
      )
      out["everything"] = {
        "enabled": True,
        "maxDepth": args.everything_max_depth,
        "connectionFirst": args.everything_connection_first,
        "connectionMaxFields": args.everything_connection_max_fields,
        "skipFields": skip_fields,
        "meta": everything_meta,
      }

      if args.out_everything_query:
        os.makedirs(os.path.dirname(args.out_everything_query) or ".", exist_ok=True)
        with open(args.out_everything_query, "w", encoding="utf-8") as f:
          f.write(everything_query)
    except Exception as e:
      out["everything"] = {
        "enabled": True,
        "error": str(e),
      }
      everything_query = None

  total_products = 0
  for v in picked:
    vendor_name = v.get("vendor")
    vendor_entry: Dict[str, Any] = {
      "vendor": vendor_name,
      "productCountInFile": v.get("productCountInFile"),
      "products": [],
    }

    for s in (v.get("sampled") or [])[:3]:
      pid = s.get("productId")
      if not pid:
        continue

      query_to_use = PRODUCT_DETAILS_QUERY
      if args.everything and everything_query:
        query_to_use = everything_query

      resp = gql_post(endpoint, token, query_to_use, variables={"id": pid}, timeout=120)
      # If product exists, paginate metafields to collect ALL (custom/unstructured included).
      try:
        product = (resp.get("data") or {}).get("product")
        if product and isinstance(product, dict):
          mf = product.get("metafields") or {}
          nodes = list((mf.get("nodes") or []))
          page_info = mf.get("pageInfo") or {}
          has_next = bool(page_info.get("hasNextPage"))
          cursor = page_info.get("endCursor")

          # Safety cap to avoid infinite loops if API misbehaves
          pages = 1
          while has_next and cursor and pages < 200:
            page = gql_post(
              endpoint,
              token,
              PRODUCT_METAFIELDS_PAGE_QUERY,
              variables={"id": pid, "after": cursor},
              timeout=90,
            )
            if page.get("errors"):
              # Keep the partial result; also attach errors for visibility
              resp.setdefault("extensions", {})
              resp["extensions"]["metafieldsPaginationErrors"] = page["errors"]
              break

            p2 = (page.get("data") or {}).get("product") or {}
            mf2 = (p2.get("metafields") or {})
            nodes2 = mf2.get("nodes") or []
            nodes.extend(nodes2)
            pi2 = mf2.get("pageInfo") or {}
            has_next = bool(pi2.get("hasNextPage"))
            cursor = pi2.get("endCursor")
            pages += 1
            time.sleep(0.02)

          # Replace with full set
          product["metafields"] = {
            "nodes": nodes,
            "pageInfo": {
              "hasNextPage": False,
              "endCursor": cursor,
            },
          }
          product["metafieldsCountFetched"] = len(nodes)
      except Exception as e:
        # Non-fatal; keep base response
        resp.setdefault("extensions", {})
        resp["extensions"]["metafieldsPaginationException"] = str(e)

      # Always record how many variants were fetched in the base response.
      # (This is independent of whether we paginate beyond the first 100.)
      try:
        product = (resp.get("data") or {}).get("product")
        if product and isinstance(product, dict):
          variants = product.get("variants") or {}
          vnodes = variants.get("nodes") or []
          if isinstance(vnodes, list) and "variantsCountFetched" not in product:
            product["variantsCountFetched"] = len(vnodes)
      except Exception as e:
        resp.setdefault("extensions", {})
        resp["extensions"]["variantsCountBaseException"] = str(e)

      # Optional: paginate variants (beyond first 100) if requested.
      try:
        if args.paginate_variants:
          product = (resp.get("data") or {}).get("product")
          if product and isinstance(product, dict):
            variants = product.get("variants") or {}
            vnodes = list((variants.get("nodes") or []))
            vpi = variants.get("pageInfo") or {}
            v_has_next = bool(vpi.get("hasNextPage"))
            v_cursor = vpi.get("endCursor")

            pages = 1
            while v_has_next and v_cursor and pages < int(args.paginate_variants_max_pages):
              page = gql_post(
                endpoint,
                token,
                PRODUCT_VARIANTS_PAGE_QUERY,
                variables={"id": pid, "after": v_cursor},
                timeout=120,
              )
              if page.get("errors"):
                resp.setdefault("extensions", {})
                resp["extensions"]["variantsPaginationErrors"] = page["errors"]
                break

              p2 = (page.get("data") or {}).get("product") or {}
              v2 = (p2.get("variants") or {})
              vnodes.extend(v2.get("nodes") or [])
              vpi2 = v2.get("pageInfo") or {}
              v_has_next = bool(vpi2.get("hasNextPage"))
              v_cursor = vpi2.get("endCursor")
              pages += 1
              time.sleep(float(args.paginate_variants_sleep))

            product["variants"] = {
              "nodes": vnodes,
              "pageInfo": {
                "hasNextPage": False,
                "endCursor": v_cursor,
              },
            }
            product["variantsCountFetched"] = len(vnodes)
      except Exception as e:
        resp.setdefault("extensions", {})
        resp["extensions"]["variantsPaginationException"] = str(e)

      # Note: In --everything mode, we intentionally do not attempt to fully paginate every connection
      # automatically (variants/images/media/collections/resourcePublications/etc) because that can explode
      # API costs quickly. If needed, we can add targeted pagination for specific connections next.

      vendor_entry["products"].append(
        {
          "productId": pid,
          "productLineInJsonl": s.get("productLine"),
          "graphql": resp,
        }
      )
      total_products += 1
      time.sleep(0.05)

    out["vendors"].append(vendor_entry)

  out["fetchedProductCount"] = total_products

  with open(args.out_details, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

  print(f"Picked vendors: {len(picked)}")
  print(f"Fetched products: {total_products}")
  print(f"Wrote schema fields: {args.out_schema}")
  print(f"Wrote product details: {args.out_details}")

  for v in out["vendors"]:
    titles: List[str] = []
    for p in v.get("products") or []:
      data = (p.get("graphql") or {}).get("data") or {}
      prod = data.get("product") or {}
      t = prod.get("title")
      if t:
        titles.append(t)
    print(f"- {v.get('vendor')}: {len(titles)} titles")

  return 0


if __name__ == "__main__":
    raise SystemExit(main())
