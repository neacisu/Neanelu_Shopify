# TScripts

TypeScript ports of the Python research scripts in `Research/Scripts/`.

## Install

Use `pnpm` (no `npm` / no `npx`).

```bash
cd /var/www/Neanelu_Shopify/Research/Scripts/TScripts
pnpm install
```

(You only need Node.js; no Shopify CLI required.)

## 1) Sample 3 products/vendor from bulk JSONL

```bash
pnpm exec tsx sample_by_vendor.ts /var/www/Neanelu_Shopify/Research/bulk-products.jsonl --k 3 --seed 42 --out /var/www/Neanelu_Shopify/Research/TSOutputs/vendor_samples_report.json
```

Deterministic (no random): sort vendors, pick the first vendor per bucket (A-Z + '#'), then take the first 3 products for each selected vendor in file order:

```bash
pnpm exec tsx sample_by_vendor.ts /var/www/Neanelu_Shopify/Research/bulk-products.jsonl --k 3 --alphabet-pick --alphabet ABCDEFGHIJKLMNOPQRSTUVWXYZ# --out /var/www/Neanelu_Shopify/Research/TSOutputs/vendor_samples_report.json
```

## 2) Fetch product details ("TOT" / everything mode)

```bash
pnpm exec tsx fetch_shopify_products.ts \
  --env /var/www/Neanelu_Shopify/Research/.env.txt \
  --report /var/www/Neanelu_Shopify/Research/TSOutputs/vendor_samples_report.json \
  --vendor-count 10 \
  --vendor-pick-mode report-order \
  --seed 42 \
  --everything \
  --everything-skip-fields publishedOnCurrentPublication \
  --paginate-variants \
  --out-details /var/www/Neanelu_Shopify/Research/TSOutputs/products_TOT_10x3.json
```

Notes:

- `--paginate-variants` is a safety feature for shops with >100 variants/product.
- App-owned metafields from other apps may still be inaccessible (Shopify limitation).

Exact Python parity (for diffing): if you want the TypeScript fetch to return the **same** `data.product` payload as Python `--everything`, re-use the Python-generated query:

```bash
pnpm exec tsx fetch_shopify_products.ts \
  --env /var/www/Neanelu_Shopify/Research/.env.txt \
  --report /var/www/Neanelu_Shopify/Research/TSOutputs/vendor_samples_report.json \
  --vendor-count 10 \
  --vendor-pick-mode report-order \
  --everything \
  --everything-query-file /var/www/Neanelu_Shopify/Research/Outputs/product_everything_query_py.graphql \
  --out-details /var/www/Neanelu_Shopify/Research/TSOutputs/products_TOT_10x3_ts_pyquery.json
```

## 3) Scrape Admin "unstructured" metafield (UNOFFICIAL)

This replicates the Python Playwright approach. It is **not** an official Admin API method.

To enable it, install Playwright:

```bash
pnpm add -D playwright
pnpm exec playwright install chromium
```

Then run:

```bash
pnpm exec tsx scrape_admin_unstructured_metafield.ts \
  --store-handle d366ab \
  --product-id 8628341506315 \
  --namespace app--3890849--eligibility \
  --key eligibility_details \
  --storage-state /var/www/Neanelu_Shopify/Research/TSOutputs/admin_storage_state.json \
  --headful
```
