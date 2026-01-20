# Comparatie completa (2 produse) – JSONL vs DB

Run: 019bdc82-2166-7284-ba58-da4234e6bd4a
JSONL local: /var/lib/neanelu/bulk-artifacts/019bd25e-f07f-7d40-bd2f-16c9ede416a1/019bdc82-2166-7284-ba58-da4234e6bd4a/bulk-result.jsonl

## Tabel comparativ (rezumat)

| Camp | Produs A (gid://shopify/Product/10816239436043) | Produs B (gid://shopify/Product/10816239468811) |
| --- | --- | --- |
| title (JSONL/DB) | seminte bio ridichi johanna - 25g | seminte pansele melanj - 025g |
| handle (JSONL/DB) | seminte-bio-ridichi-johanna-25g | seminte-pansele-melanj-025g |
| vendor (JSONL/DB) | agrosel | agrosel |
| productType (JSONL) / product_type (DB) | seminte_bio_ridichi_johanna_-_2.5g | seminte_pansele_melanj_-_0,25g |
| status (JSONL/DB) | ACTIVE | ACTIVE |
| createdAt (JSONL) / created_at_shopify (DB) | 2025-11-19T09:54:41Z | 2025-11-19T09:54:42Z |
| updatedAt (JSONL) / updated_at_shopify (DB) | 2025-11-20T03:41:58Z | 2025-11-20T03:41:59Z |
| variant id (JSONL) | gid://shopify/ProductVariant/52697833701643 | gid://shopify/ProductVariant/52697833734411 |
| variant sku (JSONL/DB) | seminte-bio-ridichi-johanna-2-5g | seminte-pansele-melanj-0-25g |
| variant price (JSONL) | "7.90" | "2.49" |
| variant price (DB) | 7.90 | 2.49 |
| inventory_item_id (JSONL/DB) | gid://shopify/InventoryItem/54685454041355 | gid://shopify/InventoryItem/54685454074123 |

## JSONL – obiecte complete (din fisier)

### Produs A (Product line)

{"__typename":"Product","id":"gid:\/\/shopify\/Product\/10816239436043","handle":"seminte-bio-ridichi-johanna-25g","title":"seminte bio ridichi johanna - 25g","vendor":"agrosel","productType":"seminte_bio_ridichi_johanna_-_2.5g","status":"ACTIVE","tags":[],"createdAt":"2025-11-19T09:54:41Z","updatedAt":"2025-11-20T03:41:58Z"}

### Produs B (Product line)

{"__typename":"Product","id":"gid:\/\/shopify\/Product\/10816239468811","handle":"seminte-pansele-melanj-025g","title":"seminte pansele melanj - 025g","vendor":"agrosel","productType":"seminte_pansele_melanj_-_0,25g","status":"ACTIVE","tags":[],"createdAt":"2025-11-19T09:54:42Z","updatedAt":"2025-11-20T03:41:59Z"}

### Varianta A (Variant line)

{"__typename":"ProductVariant","id":"gid:\/\/shopify\/ProductVariant\/52697833701643","title":"Default Title","sku":"seminte-bio-ridichi-johanna-2-5g","barcode":null,"price":"7.90","compareAtPrice":null,"taxable":true,"inventoryQuantity":0,"availableForSale":true,"inventoryPolicy":"DENY","requiresComponents":false,"selectedOptions":[{"name":"Title","value":"Default Title"}],"product":{"id":"gid:\/\/shopify\/Product\/10816239436043"},"inventoryItem":{"__typename":"InventoryItem","id":"gid:\/\/shopify\/InventoryItem\/54685454041355","tracked":false},"createdAt":"2025-11-19T09:54:41Z","updatedAt":"2025-11-19T09:54:41Z","__parentId":"gid:\/\/shopify\/Product\/10816239436043"}

### Varianta B (Variant line)

{"__typename":"ProductVariant","id":"gid:\/\/shopify\/ProductVariant\/52697833734411","title":"Default Title","sku":"seminte-pansele-melanj-0-25g","barcode":null,"price":"2.49","compareAtPrice":null,"taxable":true,"inventoryQuantity":0,"availableForSale":true,"inventoryPolicy":"DENY","requiresComponents":false,"selectedOptions":[{"name":"Title","value":"Default Title"}],"product":{"id":"gid:\/\/shopify\/Product\/10816239468811"},"inventoryItem":{"__typename":"InventoryItem","id":"gid:\/\/shopify\/InventoryItem\/54685454074123","tracked":false},"createdAt":"2025-11-19T09:54:42Z","updatedAt":"2025-11-19T09:54:42Z","__parentId":"gid:\/\/shopify\/Product\/10816239468811"}

## DB – staging_products (toate coloanele)

### Produs A (staging_products)

{
  "id": "019bdcb5-4c50-799f-b209-bb3d10408a4e",
  "seo": null,
  "tags": [],
  "title": "seminte bio ridichi johanna - 25g",
  "handle": "seminte-bio-ridichi-johanna-25g",
  "status": "ACTIVE",
  "vendor": "agrosel",
  "options": [],
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "raw_data": {
    "id": "gid://shopify/Product/10816239436043",
    "tags": [],
    "title": "seminte bio ridichi johanna - 25g",
    "handle": "seminte-bio-ridichi-johanna-25g",
    "status": "ACTIVE",
    "vendor": "agrosel",
    "createdAt": "2025-11-19T09:54:41Z",
    "updatedAt": "2025-11-20T03:41:58Z",
    "__typename": "Product",
    "productType": "seminte_bio_ridichi_johanna_-_2.5g"
  },
  "merged_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "bulk_run_id": "019bdc82-2166-7284-ba58-da4234e6bd4a",
  "description": null,
  "imported_at": "2026-01-20T18:40:27.700598+00:00",
  "shopify_gid": "gid://shopify/Product/10816239436043",
  "merge_status": "merged",
  "product_type": "seminte_bio_ridichi_johanna_-_2.5g",
  "description_html": null,
  "target_product_id": "019bdcb5-7385-7af0-bb22-18ca70f2abd2",
  "validation_errors": [],
  "validation_status": "valid",
  "legacy_resource_id": 10816239436043
}

### Produs B (staging_products)

{
  "id": "019bdcb5-4c50-7a30-b7d6-aac514cdca57",
  "seo": null,
  "tags": [],
  "title": "seminte pansele melanj - 025g",
  "handle": "seminte-pansele-melanj-025g",
  "status": "ACTIVE",
  "vendor": "agrosel",
  "options": [],
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "raw_data": {
    "id": "gid://shopify/Product/10816239468811",
    "tags": [],
    "title": "seminte pansele melanj - 025g",
    "handle": "seminte-pansele-melanj-025g",
    "status": "ACTIVE",
    "vendor": "agrosel",
    "createdAt": "2025-11-19T09:54:42Z",
    "updatedAt": "2025-11-20T03:41:59Z",
    "__typename": "Product",
    "productType": "seminte_pansele_melanj_-_0,25g"
  },
  "merged_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "bulk_run_id": "019bdc82-2166-7284-ba58-da4234e6bd4a",
  "description": null,
  "imported_at": "2026-01-20T18:40:27.700598+00:00",
  "shopify_gid": "gid://shopify/Product/10816239468811",
  "merge_status": "merged",
  "product_type": "seminte_pansele_melanj_-_0,25g",
  "description_html": null,
  "target_product_id": "019bdcb5-7385-7b94-9c35-c1750c11458b",
  "validation_errors": [],
  "validation_status": "valid",
  "legacy_resource_id": 10816239468811
}

## DB – shopify_products (toate coloanele)

### Produs A (shopify_products)

{
  "id": "019bdcb5-7385-7af0-bb22-18ca70f2abd2",
  "seo": null,
  "tags": [],
  "title": "seminte bio ridichi johanna - 25g",
  "handle": "seminte-bio-ridichi-johanna-25g",
  "status": "ACTIVE",
  "vendor": "agrosel",
  "options": [],
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "synced_at": "2026-01-20T18:40:27.815117+00:00",
  "created_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "updated_at": "2026-01-20T18:40:27.815117+00:00",
  "category_id": null,
  "description": null,
  "price_range": null,
  "shopify_gid": "gid://shopify/Product/10816239436043",
  "is_gift_card": false,
  "product_type": "seminte_bio_ridichi_johanna_-_2.5g",
  "published_at": null,
  "template_suffix": null,
  "description_html": null,
  "created_at_shopify": "2025-11-19T09:54:41+00:00",
  "featured_image_url": null,
  "legacy_resource_id": 10816239436043,
  "updated_at_shopify": "2025-11-20T03:41:58+00:00",
  "requires_selling_plan": false,
  "compare_at_price_range": null,
  "has_only_default_variant": true,
  "has_out_of_stock_variants": false
}

### Produs B (shopify_products)

{
  "id": "019bdcb5-7385-7b94-9c35-c1750c11458b",
  "seo": null,
  "tags": [],
  "title": "seminte pansele melanj - 025g",
  "handle": "seminte-pansele-melanj-025g",
  "status": "ACTIVE",
  "vendor": "agrosel",
  "options": [],
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "synced_at": "2026-01-20T18:40:27.815117+00:00",
  "created_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "updated_at": "2026-01-20T18:40:27.815117+00:00",
  "category_id": null,
  "description": null,
  "price_range": null,
  "shopify_gid": "gid://shopify/Product/10816239468811",
  "is_gift_card": false,
  "product_type": "seminte_pansele_melanj_-_0,25g",
  "published_at": null,
  "template_suffix": null,
  "description_html": null,
  "created_at_shopify": "2025-11-19T09:54:42+00:00",
  "featured_image_url": null,
  "legacy_resource_id": 10816239468811,
  "updated_at_shopify": "2025-11-20T03:41:59+00:00",
  "requires_selling_plan": false,
  "compare_at_price_range": null,
  "has_only_default_variant": true,
  "has_out_of_stock_variants": false
}

## DB – staging_variants (toate coloanele)

### Varianta A (staging_variants)

{
  "id": "019bdcb5-4c89-76b5-ba78-d24631db1165",
  "sku": "seminte-bio-ridichi-johanna-2-5g",
  "cost": null,
  "price": 7.90,
  "title": "Default Title",
  "weight": null,
  "barcode": null,
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "raw_data": {
    "id": "gid://shopify/ProductVariant/52697833701643",
    "sku": "seminte-bio-ridichi-johanna-2-5g",
    "price": "7.90",
    "title": "Default Title",
    "barcode": null,
    "product": {
      "id": "gid://shopify/Product/10816239436043"
    },
    "taxable": true,
    "createdAt": "2025-11-19T09:54:41Z",
    "updatedAt": "2025-11-19T09:54:41Z",
    "__parentId": "gid://shopify/Product/10816239436043",
    "__typename": "ProductVariant",
    "inventoryItem": {
      "id": "gid://shopify/InventoryItem/54685454041355",
      "tracked": false,
      "__typename": "InventoryItem"
    },
    "compareAtPrice": null,
    "inventoryPolicy": "DENY",
    "selectedOptions": [
      {
        "name": "Title",
        "value": "Default Title"
      }
    ],
    "availableForSale": true,
    "inventoryQuantity": 0,
    "requiresComponents": false
  },
  "merged_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "bulk_run_id": "019bdc82-2166-7284-ba58-da4234e6bd4a",
  "imported_at": "2026-01-20T18:40:27.75769+00:00",
  "shopify_gid": "gid://shopify/ProductVariant/52697833701643",
  "weight_unit": null,
  "merge_status": "merged",
  "compare_at_price": 7.90,
  "selected_options": [
    {
      "name": "Title",
      "value": "Default Title"
    }
  ],
  "inventory_item_id": "gid://shopify/InventoryItem/54685454041355",
  "target_variant_id": "019bdcb7-b073-73be-b8d2-acacd58975fe",
  "validation_errors": [],
  "validation_status": "valid",
  "inventory_quantity": 0,
  "legacy_resource_id": 52697833701643,
  "staging_product_id": null
}

### Varianta B (staging_variants)

{
  "id": "019bdcb5-4c89-7727-a1ae-1d04389e51c9",
  "sku": "seminte-pansele-melanj-0-25g",
  "cost": null,
  "price": 2.49,
  "title": "Default Title",
  "weight": null,
  "barcode": null,
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "raw_data": {
    "id": "gid://shopify/ProductVariant/52697833734411",
    "sku": "seminte-pansele-melanj-0-25g",
    "price": "2.49",
    "title": "Default Title",
    "barcode": null,
    "product": {
      "id": "gid://shopify/Product/10816239468811"
    },
    "taxable": true,
    "createdAt": "2025-11-19T09:54:42Z",
    "updatedAt": "2025-11-19T09:54:42Z",
    "__parentId": "gid://shopify/Product/10816239468811",
    "__typename": "ProductVariant",
    "inventoryItem": {
      "id": "gid://shopify/InventoryItem/54685454074123",
      "tracked": false,
      "__typename": "InventoryItem"
    },
    "compareAtPrice": null,
    "inventoryPolicy": "DENY",
    "selectedOptions": [
      {
        "name": "Title",
        "value": "Default Title"
      }
    ],
    "availableForSale": true,
    "inventoryQuantity": 0,
    "requiresComponents": false
  },
  "merged_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "bulk_run_id": "019bdc82-2166-7284-ba58-da4234e6bd4a",
  "imported_at": "2026-01-20T18:40:27.75769+00:00",
  "shopify_gid": "gid://shopify/ProductVariant/52697833734411",
  "weight_unit": null,
  "merge_status": "merged",
  "compare_at_price": 2.49,
  "selected_options": [
    {
      "name": "Title",
      "value": "Default Title"
    }
  ],
  "inventory_item_id": "gid://shopify/InventoryItem/54685454074123",
  "target_variant_id": "019bdcb7-b073-745e-afd7-c795ee4e4fed",
  "validation_errors": [],
  "validation_status": "valid",
  "inventory_quantity": 0,
  "legacy_resource_id": 52697833734411,
  "staging_product_id": null
}

## DB – shopify_variants (toate coloanele)

### Varianta A (shopify_variants)

{
  "id": "019bdcb7-b073-73be-b8d2-acacd58975fe",
  "sku": "seminte-bio-ridichi-johanna-2-5g",
  "cost": null,
  "price": 7.90,
  "title": "Default Title",
  "weight": null,
  "barcode": null,
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "taxable": true,
  "position": 1,
  "tax_code": null,
  "image_url": null,
  "synced_at": "2026-01-20T18:40:27.815117+00:00",
  "created_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "product_id": "019bdcb5-7385-7af0-bb22-18ca70f2abd2",
  "updated_at": "2026-01-20T18:40:27.815117+00:00",
  "shopify_gid": "gid://shopify/ProductVariant/52697833701643",
  "weight_unit": "KILOGRAMS",
  "currency_code": "RON",
  "compare_at_price": 7.90,
  "inventory_policy": "DENY",
  "selected_options": [
    {
      "name": "Title",
      "value": "Default Title"
    }
  ],
  "inventory_item_id": "gid://shopify/InventoryItem/54685454041355",
  "requires_shipping": true,
  "available_for_sale": true,
  "created_at_shopify": "2025-11-19T09:54:41+00:00",
  "inventory_quantity": 0,
  "legacy_resource_id": 52697833701643,
  "updated_at_shopify": "2025-11-19T09:54:41+00:00",
  "requires_components": false
}

### Varianta B (shopify_variants)

{
  "id": "019bdcb7-b073-745e-afd7-c795ee4e4fed",
  "sku": "seminte-pansele-melanj-0-25g",
  "cost": null,
  "price": 2.49,
  "title": "Default Title",
  "weight": null,
  "barcode": null,
  "shop_id": "019bd25e-f07f-7d40-bd2f-16c9ede416a1",
  "taxable": true,
  "position": 1,
  "tax_code": null,
  "image_url": null,
  "synced_at": "2026-01-20T18:40:27.815117+00:00",
  "created_at": "2026-01-20T18:40:27.815117+00:00",
  "metafields": {},
  "product_id": "019bdcb5-7385-7b94-9c35-c1750c11458b",
  "updated_at": "2026-01-20T18:40:27.815117+00:00",
  "shopify_gid": "gid://shopify/ProductVariant/52697833734411",
  "weight_unit": "KILOGRAMS",
  "currency_code": "RON",
  "compare_at_price": 2.49,
  "inventory_policy": "DENY",
  "selected_options": [
    {
      "name": "Title",
      "value": "Default Title"
    }
  ],
  "inventory_item_id": "gid://shopify/InventoryItem/54685454074123",
  "requires_shipping": true,
  "available_for_sale": true,
  "created_at_shopify": "2025-11-19T09:54:42+00:00",
  "inventory_quantity": 0,
  "legacy_resource_id": 52697833734411,
  "updated_at_shopify": "2025-11-19T09:54:42+00:00",
  "requires_components": false
}
