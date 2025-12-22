# Research

Structură pentru experimente/analize pe exportul Bulk (JSONL) și pe citiri Admin GraphQL.

## Directoare

- `Scripts/` – scripturi Python folosite pentru sampling și interogări Admin GraphQL.
- `Outputs/` – fișiere JSON generate (rapoarte, rezultate interogări, introspecții).
- `Notes/` – notițe și documentație de lucru.

## Rulare

- Sampling vendors + 3 produse/vendor din JSONL:
  - `python3 Research/Scripts/sample_by_vendor.py Research/bulk-products.jsonl --k 3 --seed 20251222`

- Fetch detalii produse din store pentru 10 vendori x 3 produse:
  - `python3 Research/Scripts/fetch_shopify_products.py --vendor-count 10 --seed 20251222 --api-version 2025-10`

Notă: `SHOPIFY_SHOP_DOMAIN` și `SHOPIFY_ADMIN_API_TOKEN` sunt citite din `.env.txt` (în root).
