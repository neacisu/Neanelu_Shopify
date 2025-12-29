# Neanelu PIM - PostgreSQL Database Schema v2.5 (Complete)

> **PostgreSQL 18.1** | **pgvector** | **UUIDv7** | **RLS Multi-tenancy**
>
> **Last Updated:** 2025-12-29 | **Total Tables:** 63 + 4 MVs | **Status:** ✅ Production Ready
>
> ⚠️ **SOURCE OF TRUTH:** Acest document este sursa definitivă pentru toate schemele de baze de date, inclusiv PIM.
> Fișierul `Schemă_Bază_Date_PIM.sql` este **DEPRECATED** și nu trebuie folosit pentru implementare.

---

## Table of Contents

1. [Module A: System Core & Multi-tenancy](#module-a-system-core--multi-tenancy) (3 tables)
2. [Module B: Shopify Mirror](#module-b-shopify-mirror) (8 tables)
3. [Module C: Bulk Operations & Staging](#module-c-bulk-operations--staging) (6 tables)
4. [Module D: Global PIM](#module-d-global-pim) (8 tables)
5. [Module D Additions: PIM Consensus & Deduplication](#module-d-additions-pim-consensus--deduplication) (4 tables)
6. [Module E: Attribute Normalization & Vectors](#module-e-attribute-normalization--vectors) (4 tables)
7. [Module F: AI Batch Processing](#module-f-ai-batch-processing) (2 tables)
8. [Module G: Queue & Job Tracking](#module-g-queue--job-tracking) (2 tables)
9. [Module H: Audit & Observability](#module-h-audit--observability) (2 tables)
10. [Module I: Inventory Ledger](#module-i-inventory-ledger-high-velocity-tracking) (2 tables + 1 MV)
11. [Module J: Shopify Media & Publications](#module-j-shopify-media--publications) (5 tables)
12. [Module K: Menus & Navigation](#module-k-menus--navigation) (2 tables)
13. [Module L: Scraper & Crawler Management](#module-l-scraper--crawler-management) (3 tables)
14. [Module M: Analytics & Reporting](#module-m-analytics--reporting) (2 tables)
15. [Extensions Required](#extensions-required)
16. [Shopify GraphQL ↔ PostgreSQL Data Type Mapping](#shopify-graphql--postgresql-data-type-mapping)
17. [RLS Policies - Complete Reference](#rls-policies---complete-reference)
18. [Partitioning Strategies](#partitioning-strategies)
19. [Index Optimization Guidelines](#index-optimization-guidelines)
20. [Migration Order](#migration-order)

---

## Module A: System Core & Multi-tenancy

### Table: `shops`

| Column                  | Type        | Constraints              | Description                            |
| ----------------------- | ----------- | ------------------------ | -------------------------------------- |
| id                      | UUID        | PK DEFAULT uuidv7()      | Shop identifier                        |
| shopify_domain          | CITEXT      | UNIQUE NOT NULL          | myshop.myshopify.com                   |
| shopify_shop_id         | BIGINT      | UNIQUE                   | Shopify numeric ID for API correlation |
| plan_tier               | VARCHAR(20) | NOT NULL DEFAULT 'basic' | basic/pro/enterprise                   |
| api_version             | VARCHAR(20) | DEFAULT '2025-10'        | Current Shopify API version            |
| access_token_ciphertext | BYTEA       | NOT NULL                 | AES-256-GCM encrypted                  |
| access_token_iv         | BYTEA       | NOT NULL                 | Initialization vector                  |
| access_token_tag        | BYTEA       | NOT NULL                 | Auth tag                               |
| webhook_secret          | BYTEA       |                          | HMAC validation key for webhooks       |
| key_version             | INTEGER     | NOT NULL DEFAULT 1       | Key rotation version                   |
| scopes                  | TEXT[]      | NOT NULL                 | Granted OAuth scopes.                  |
| timezone                | VARCHAR(50) | DEFAULT 'Europe/Bucharest' | Shop timezone (IANA)                   |
| currency_code           | VARCHAR(3)  | DEFAULT 'RON'            | Primary currency (ISO 4217)            |
| settings                | JSONB       | DEFAULT '{}'             | Shop-level config                      |
| installed_at            | TIMESTAMPTZ | DEFAULT now()            | Install timestamp                      |
| uninstalled_at          | TIMESTAMPTZ |                          | Uninstall timestamp                    |
| created_at              | TIMESTAMPTZ | DEFAULT now()            |                                        |
| updated_at              | TIMESTAMPTZ | DEFAULT now()            |                                        |

**Indexes:**

- `idx_shops_domain` UNIQUE ON (shopify_domain)
- `idx_shops_plan` ON (plan_tier)
- `idx_shops_shopify_id` ON (shopify_shop_id) WHERE shopify_shop_id IS NOT NULL

---

### Table: `staff_users`

| Column        | Type        | Constraints               | Description      |
| ------------- | ------------| ------------------------- | ---------------- |
| id            | UUID        | PK DEFAULT uuidv7()       |                  |
| shop_id       | UUID        | FK shops(id) NOT NULL     |                  |
| email         | CITEXT      | NOT NULL                  |                  |
| first_name    | VARCHAR(100)|                           |                  |
| last_name     | VARCHAR(100)|                           |                  |
| role          | JSONB       | DEFAULT '{"admin":false}' | Role permissions |
| locale        | VARCHAR(10) | DEFAULT 'en'              |                  |
| last_login_at | TIMESTAMPTZ |                           |                  |
| created_at    | TIMESTAMPTZ | DEFAULT now()             |                  |

**Indexes:**

- `idx_staff_shop_email` UNIQUE ON (shop_id, email)

**RLS Policy:** `staff_users_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `app_sessions`

| Column        | Type        | Constraints           | Description  |
| ------------- | ------------| --------------------- | ------------ |
| id            | VARCHAR(255)| PK                    | Session ID   |
| shop_id       | UUID        | FK shops(id) NOT NULL |              |
| payload       | JSONB       | NOT NULL              | Session data |
| expires_at    | TIMESTAMPTZ | NOT NULL              | Expiration   |
| created_at    | TIMESTAMPTZ | DEFAULT now()         |              |

**Indexes:**

- `idx_sessions_shop` ON (shop_id)
- `idx_sessions_expires` ON (expires_at)

---

### Table: `oauth_states`

> **Purpose:** CSRF protection for OAuth flow (F3.2) - Temporary, no RLS needed

| Column        | Type        | Constraints         | Description            |
| ------------- | ------------| ------------------- | ---------------------- |
| id            | UUID        | PK DEFAULT uuidv7() | State identifier       |
| state         | VARCHAR(64) | UNIQUE NOT NULL     | Random state token     |
| shop_domain   | CITEXT      | NOT NULL            | Target shop domain     |
| redirect_uri  | TEXT        | NOT NULL            | Return URL after OAuth |
| nonce         | VARCHAR(64) | NOT NULL            | Additional entropy     |
| expires_at    | TIMESTAMPTZ | NOT NULL            | TTL (5-10 min)         |
| used_at       | TIMESTAMPTZ |                     | When consumed          |
| created_at    | TIMESTAMPTZ | DEFAULT now()       |                        |

**Indexes:**

- `idx_oauth_states_state` UNIQUE ON (state)
- `idx_oauth_states_expires` ON (expires_at) WHERE used_at IS NULL

**Note:** No RLS - pre-authentication table. Cleanup job deletes expired entries.

---

### Table: `oauth_nonces`

> **Purpose:** Replay attack protection for OAuth (F3.2)

| Column        | Type        | Constraints         | Description      |
| ------------- | ------------| ------------------- | ---------------- |
| id            | UUID        | PK DEFAULT uuidv7() | Nonce identifier |
| nonce         | VARCHAR(64) | UNIQUE NOT NULL     | Random nonce     |
| shop_id       | UUID        | FK shops(id)        | Associated shop  |
| used_at       | TIMESTAMPTZ |                     | When consumed    |
| expires_at    | TIMESTAMPTZ | NOT NULL            | TTL              |
| created_at    | TIMESTAMPTZ | DEFAULT now()       |                  |

**Indexes:**

- `idx_oauth_nonces_nonce` UNIQUE ON (nonce)
- `idx_oauth_nonces_expires` ON (expires_at)

---

### Table: `key_rotations`

> **Purpose:** Audit trail for encryption key rotation (F2.2.3.2)

| Column          | Type        | Constraints                    | Description                   |
| --------------- | ------------| ------------------------------ | ----------------------------- |
| id              | UUID        | PK DEFAULT uuidv7()            | Rotation identifier           |
| key_version_old | INTEGER     | NOT NULL                       | Previous key version          |
| key_version_new | INTEGER     | NOT NULL                       | New key version               |
| initiated_by    | UUID        | FK staff_users(id)             | Who started rotation          |
| status          | VARCHAR(20) | NOT NULL DEFAULT 'in_progress' | in_progress/completed/failed  |
| records_updated | INTEGER     | DEFAULT 0                      | Count of re-encrypted records |
| started_at      | TIMESTAMPTZ | DEFAULT now()                  |                               |
| completed_at    | TIMESTAMPTZ |                                |                               |
| error_message   | TEXT        |                                | If failed                     |

**Indexes:**

- `idx_key_rotations_status` ON (status) WHERE status = 'in_progress'

---

### Table: `feature_flags`

> **Purpose:** Per-shop feature flag configurations (F7.0)

| Column             | Type         | Constraints             | Description                |
| ------------------ | ------------ | ----------------------- | -------------------------- |
| id                 | UUID         | PK DEFAULT uuidv7()     | Flag identifier            |
| flag_key           | VARCHAR(100) | UNIQUE NOT NULL         | Flag name (e.g., 'bulk_v2')|
| description        | TEXT         |                         | Purpose description        |
| default_value      | BOOLEAN      | NOT NULL DEFAULT false  | Default state              |
| is_active          | BOOLEAN      | NOT NULL DEFAULT true   | Kill switch                |
| rollout_percentage | INTEGER      | DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100) | Gradual rollout (0-100%) |
| allowed_shop_ids   | UUID[]       | DEFAULT '{}'            | Whitelist                  |
| blocked_shop_ids   | UUID[]       | DEFAULT '{}'            | Blacklist                  |
| conditions         | JSONB        | DEFAULT '{}'            | Complex rules              |
| created_by         | UUID         | FK staff_users(id)      |                            |
| created_at         | TIMESTAMPTZ  | DEFAULT now()           |                            |
| updated_at         | TIMESTAMPTZ  | DEFAULT now()           |                            |

**Indexes:**

- `idx_feature_flags_key` UNIQUE ON (flag_key)
- `idx_feature_flags_active` ON (is_active) WHERE is_active = true

---

### Table: `system_config`

> **Purpose:** Persistent system-wide configuration (F0.1)

| Column       | Type         | Constraints        | Description   |
| ------------ | ------------ | ------------------ | ------------- |
| key          | VARCHAR(100) | PK                 | Config key    |
| value        | JSONB        | NOT NULL           | Config value  |
| description  | TEXT         |                    | Purpose       |
| is_sensitive | BOOLEAN      | DEFAULT false      | Mask in UI    |
| updated_by   | UUID         | FK staff_users(id) | Last modifier |
| updated_at   | TIMESTAMPTZ  | DEFAULT now()      |               |
| created_at   | TIMESTAMPTZ  | DEFAULT now()      |               |

---

### Table: `migration_history`

> **Purpose:** Track DB migrations for zero-downtime deploys (F7.3)

| Column            | Type         | Constraints           | Description          |
| ----------------- | ------------ | --------------------- | -------------------- |
| id                | UUID         | PK DEFAULT uuidv7()   | Migration identifier |
| migration_name    | VARCHAR(255) | UNIQUE NOT NULL       | Migration file name  |
| checksum          | VARCHAR(64)  | NOT NULL              | SHA-256 of migration |
| applied_at        | TIMESTAMPTZ  | DEFAULT now()         | When applied         |
| applied_by        | VARCHAR(100) | DEFAULT current_user  | Role that ran it     |
| execution_time_ms | INTEGER      |                       | Duration             |
| success           | BOOLEAN      | NOT NULL DEFAULT true |                      |
| error_message     | TEXT         |                       | If failed            |

**Indexes:**

- `idx_migration_name` UNIQUE ON (migration_name)
- `idx_migration_applied` ON (applied_at DESC)

---

## Module B: Shopify Mirror

### Table: `shopify_products`

| Column                     | Type         | Constraints           | Description               |
| -------------------------- | ------------ | --------------------- | ------------------------- |
| id                         | UUID         | PK DEFAULT uuidv7()   | Internal ID               |
| shop_id                    | UUID         | FK shops(id) NOT NULL |                           |
| shopify_gid                | VARCHAR(100) | NOT NULL              | gid://shopify/Product/123 |
| legacy_resource_id         | BIGINT       | NOT NULL              | Numeric Shopify ID        |
| title                      | TEXT         | NOT NULL              | Product title             |
| handle                     | VARCHAR(255) | NOT NULL              | URL handle                |
| description                | TEXT         |                       | Plain text                |
| description_html           | TEXT         |                       | HTML description          |
| vendor                     | VARCHAR(255) |                       | Brand/Vendor              |
| product_type               | VARCHAR(255) |                       | Product type              |
| status                     | VARCHAR(20)  | NOT NULL              | ACTIVE/DRAFT/ARCHIVED     |
| tags                       | TEXT[]       | DEFAULT '{}'          | Product tags              |
| is_gift_card               | BOOLEAN      | DEFAULT false         |                           |
| has_only_default_variant   | BOOLEAN      | DEFAULT true          |                           |
| has_out_of_stock_variants  | BOOLEAN      | DEFAULT false         |                           |
| requires_selling_plan      | BOOLEAN      | DEFAULT false         | Subscription only         |
| options                    | JSONB        | DEFAULT '[]'          | [{name,position,values}]  |
| seo                        | JSONB        |                       | {title,description}       |
| price_range                | JSONB        |                       | {min,max,currency}        |
| compare_at_price_range     | JSONB        |                       | {min,max,currency}        |
| featured_image_url         | TEXT         |                       | Primary image URL         |
| template_suffix            | VARCHAR(100) |                       | Theme template            |
| category_id                | VARCHAR(100) |                       | Shopify taxonomy ID       |
| metafields                 | JSONB        | DEFAULT '{}'          | Key metafields cache      |
| published_at               | TIMESTAMPTZ  |                       | Publish date              |
| created_at_shopify         | TIMESTAMPTZ  |                       | Shopify created           |
| updated_at_shopify         | TIMESTAMPTZ  |                       | Shopify updated           |
| synced_at                  | TIMESTAMPTZ  | DEFAULT now()         | Last sync                 |
| created_at                 | TIMESTAMPTZ  | DEFAULT now()         |                           |
| updated_at                 | TIMESTAMPTZ  | DEFAULT now()         |                           |

**Indexes:**

- `idx_products_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_products_shop_handle` ON (shop_id, handle)
- `idx_products_shop_status` ON (shop_id, status)
- `idx_products_shop_vendor` ON (shop_id, vendor)
- `idx_products_tags` GIN ON (tags)
- `idx_products_metafields` GIN ON (metafields jsonb_path_ops)
- `idx_products_fts` GIN ON (to_tsvector('simple', title || ' ' || COALESCE(description,'')))

**RLS Policy:** `products_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_variants`

| Column             | Type           | Constraints                      | Description               |
| ------------------ | -------------- | -------------------------------- | ------------------------- |
| id                 | UUID           | PK DEFAULT uuidv7()              | Internal ID               |
| shop_id            | UUID           | FK shops(id) NOT NULL            |                           |
| product_id         | UUID           | FK shopify_products(id) NOT NULL |                           |
| shopify_gid        | VARCHAR(100)   | NOT NULL                         | gid://shopify/Product/123 |
| legacy_resource_id | BIGINT         | NOT NULL                         | Numeric Shopify ID        |
| title              | VARCHAR(255)   | NOT NULL                         | Variant title             |
| sku                | VARCHAR(255)   |                                  | Stock keeping unit (optional in Shopify) |
| barcode            | VARCHAR(100)   |                                  | UPC/EAN/ISBN (optional in Shopify)       |
| price              | DECIMAL(12,2)  | NOT NULL                         |                           |
| compare_at_price   | DECIMAL(12,2)  | NOT NULL                         |                           |
| currency_code      | VARCHAR(3)     | DEFAULT 'RON'                    |                           |
| cost               | DECIMAL(12,2)  |                                  | Unit cost                 |
| weight             | DECIMAL(10,4)  |                                  |                           |
| weight_unit        | VARCHAR(20)    | DEFAULT 'KILOGRAMS'              |                           |
| inventory_quantity | INTEGER        | DEFAULT 0                        |                           |
| inventory_policy   | VARCHAR(20)    | DEFAULT 'DENY'                   | DENY/CONTINUE             |
| inventory_item_id  | VARCHAR(100)   |                                  | Inventory item GID        |
| taxable            | BOOLEAN        | DEFAULT true                     |                           |
| tax_code           | VARCHAR(50)    |                                  | Tax code                  |
| available_for_sale | BOOLEAN        | DEFAULT true                     |                           |
| requires_shipping  | BOOLEAN        | DEFAULT true                     |                           |
| requires_components| BOOLEAN        | DEFAULT false                    | Bundle variant            |
| position           | INTEGER        | DEFAULT 1                        | Sort order                |
| selected_options   | JSONB          | DEFAULT '[]'                     | [{name,value}]            |
| image_url          | TEXT           |                                  | Variant image             |
| metafields         | JSONB          | DEFAULT '{}'                     |                           |
| created_at_shopify | TIMESTAMPTZ    |                                  |                           |
| updated_at_shopify | TIMESTAMPTZ    |                                  |                           |
| synced_at          | TIMESTAMPTZ    | DEFAULT now()                    |                           |
| created_at         | TIMESTAMPTZ    | DEFAULT now()                    |                           |
| updated_at         | TIMESTAMPTZ    | DEFAULT now()                    |                           |

**Indexes:**

- `idx_variants_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_variants_product` ON (product_id)
- `idx_variants_shop_sku` ON (shop_id, sku) WHERE sku IS NOT NULL
- `idx_variants_shop_barcode` ON (shop_id, barcode) WHERE barcode IS NOT NULL
- `idx_variants_inventory` ON (shop_id, inventory_quantity)

**RLS Policy:** `variants_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_collections`

| Column             | Type           | Constraints           | Description                  |
| ------------------ | -------------- | --------------------- | ---------------------------- |
| id                 | UUID           | PK DEFAULT uuidv7()   | Internal ID                  |
| shop_id            | UUID           | FK shops(id) NOT NULL |                              |
| shopify_gid        | VARCHAR(100)   | NOT NULL              | gid://shopify/Collection/123 |
| legacy_resource_id | BIGINT         | NOT NULL              | Numeric Shopify ID           |
| title              | TEXT           | NOT NULL              | Collection title             |
| handle             | VARCHAR(255)   | NOT NULL              | Collection handle            |
| description        | TEXT           |                       | Collection description       |
| description_html   | TEXT           |                       | Collection description HTML  |
| collection_type    | VARCHAR(20)    | NOT NULL              | MANUAL/SMART                 |
| sort_order         | VARCHAR(50)    |                       | BEST_SELLING/ALPHA etc       |
| rules              | JSONB          |                       | Smart collection rules       |
| disjunctive        | BOOLEAN        | DEFAULT false         | OR vs AND rules              |
| seo                | JSONB          |                       |                              |
| image_url          | TEXT           |                       | Collection image             |
| products_count     | INTEGER        | DEFAULT 0             |                              |
| template_suffix    | VARCHAR(100)   |                       |                              |
| published_at       | TIMESTAMPTZ    |                       |                              |
| synced_at          | TIMESTAMPTZ    | DEFAULT now()         |                              |
| created_at         | TIMESTAMPTZ    | DEFAULT now()         |                              |
| updated_at         | TIMESTAMPTZ    | DEFAULT now()         |                              |

**Indexes:**

- `idx_collections_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_collections_shop_handle` ON (shop_id, handle)
- `idx_collections_type` ON (shop_id, collection_type)

---

### Table: `shopify_collection_products`

| Column        | Type        | Constraints                     | Description                     |
| ------------- | ----------- | ------------------------------- | ------------------------------- |
| shop_id       | UUID        | FK shops(id) NOT NULL           | Tenant (denormalized for RLS)   |
| collection_id | UUID        | FK shopify_collections(id)      |                                 |
| product_id    | UUID        | FK shopify_products(id)         |                                 |
| position      | INTEGER     | DEFAULT 0                       | Sort position                   |
| created_at    | TIMESTAMPTZ | DEFAULT now()                   |                                 |
| updated_at    | TIMESTAMPTZ | DEFAULT now()                   |                                 |

**Primary Key:** (collection_id, product_id)

**Indexes:**

- `idx_collection_products_shop` ON (shop_id)
- `idx_collection_products_product` ON (product_id) -- Reverse lookup

**RLS Policy:** `collection_products_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_orders`

| Column               | Type          | Constraints              | Description                   |
| -------------------- | ------------- | ------------------------ | ----------------------------- |
| id                   | UUID          | PK DEFAULT uuidv7()      |                               |
| shop_id              | UUID          | FK shops(id) NOT NULL    |                               |
| shopify_gid          | VARCHAR(100)  | NOT NULL                 |                               |
| legacy_resource_id   | BIGINT        | NOT NULL                 |                               |
| name                 | VARCHAR(50)   | NOT NULL                 |                               |
| order_number         | INTEGER       | NOT NULL                 |                               |
| email                | CITEXT        |                          | Customer email                |
| phone                | VARCHAR(50)   |                          |                               |
| financial_status     | VARCHAR(30)   |                          | PENDING/PAID/REFUNDED         |
| fulfillment_status   | VARCHAR(30)   |                          | UNFULFILLED/FULFILLED         |
| total_price          | DECIMAL(12,2) | NOT NULL                 |                               |
| subtotal_price       | DECIMAL(12,2) |                          |                               |
| total_tax            | DECIMAL(12,2) |                          |                               |
| total_discounts      | DECIMAL(12,2) |                          |                               |
| total_shipping       | DECIMAL(12,2) |                          |                               |
| currency_code        | VARCHAR(3)    | NOT NULL                 |                               |
| presentment_currency | VARCHAR(3)    |                          | Customer currency             |
| line_items           | JSONB         | NOT NULL                 | [{variant_id,quantity,price}] |
| shipping_lines       | JSONB         | DEFAULT '[]'             |                               |
| discount_codes       | JSONB         | DEFAULT '[]'             |                               |
| shipping_address     | JSONB         |                          |                               |
| billing_address      | JSONB         |                          |                               |
| customer_id          | UUID          | FK shopify_customers(id) |                               |
| customer_locale      | VARCHAR(10)   |                          |                               |
| tags                 | TEXT[]        | DEFAULT '{}'             |                               |
| note                 | TEXT          |                          |                               |
| note_attributes      | JSONB         | DEFAULT '[]'             |                               |
| gateway              | VARCHAR(100)  |                          | Payment gateway               |
| payment_terms        | JSONB         |                          | B2B terms                     |
| risk_level           | VARCHAR(20)   |                          | LOW/MEDIUM/HIGH               |
| source_name          | VARCHAR(100)  |                          | web/pos/api                   |
| source_identifier    | VARCHAR(255)  |                          |                               |
| cancelled_at         | TIMESTAMPTZ   |                          |                               |
| cancel_reason        | VARCHAR(50)   |                          |                               |
| closed_at            | TIMESTAMPTZ   |                          |                               |
| processed_at         | TIMESTAMPTZ   |                          |                               |
| created_at_shopify   | TIMESTAMPTZ   |                          |                               |
| updated_at_shopify   | TIMESTAMPTZ   |                          |                               |
| synced_at            | TIMESTAMPTZ   | DEFAULT now()            |                               |
| created_at           | TIMESTAMPTZ   | DEFAULT now()            |                               |
| updated_at           | TIMESTAMPTZ   | DEFAULT now()            |                               |

**Indexes:**

- `idx_orders_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_orders_shop_number` ON (shop_id, order_number)
- `idx_orders_shop_email` ON (shop_id, email)
- `idx_orders_customer` ON (customer_id)
- `idx_orders_financial` ON (shop_id, financial_status)
- `idx_orders_fulfillment` ON (shop_id, fulfillment_status)
- `idx_orders_created` ON (shop_id, created_at_shopify DESC)
- `idx_orders_line_items` GIN ON (line_items jsonb_path_ops)

---

### Table: `shopify_customers`

| Column                       | Type          | Constraints           | Description              |
| ---------------------------- | ------------- | --------------------- | ------------------------ |
| id                           | UUID          | PK DEFAULT uuidv7()   |                          |
| shop_id                      | UUID          | FK shops(id) NOT NULL |                          |
| shopify_gid                  | VARCHAR(100)  | NOT NULL              |                          |
| legacy_resource_id           | BIGINT        | NOT NULL              |                          |
| email                        | CITEXT        |                       |                          |
| phone                        | VARCHAR(50)   |                       |                          |
| first_name                   | VARCHAR(100)  |                       |                          |
| last_name                    | VARCHAR(100)  |                       |                          |
| display_name                 | VARCHAR(255)  |                       |                          |
| state                        | VARCHAR(20)   | DEFAULT 'ENABLED'     | ENABLED/DISABLED/INVITED |
| verified_email               | BOOLEAN       | DEFAULT false         |                          |
| accepts_marketing            | BOOLEAN       | DEFAULT false         |                          |
| accepts_marketing_updated_at | TIMESTAMPTZ   |                       |                          |
| marketing_opt_in_level       | VARCHAR(30)   |                       |                          |
| orders_count                 | INTEGER       | DEFAULT 0             |                          |
| total_spent                  | DECIMAL(12,2) | DEFAULT 0             |                          |
| average_order_amount         | DECIMAL(12,2) |                       |                          |
| currency_code                | VARCHAR(3)    |                       |                          |
| tags                         | TEXT[]        | DEFAULT '{}'          |                          |
| tax_exempt                   | BOOLEAN       | DEFAULT false         |                          |
| tax_exemptions               | TEXT[]        | DEFAULT '{}'          |                          |
| locale                       | VARCHAR(10)   |                       |                          |
| note                         | TEXT          |                       |                          |
| default_address              | JSONB         |                       |                          |
| addresses                    | JSONB         | DEFAULT '[]'          |                          |
| metafields                   | JSONB         | DEFAULT '{}'          |                          |
| created_at_shopify           | TIMESTAMPTZ   |                       |                          |
| updated_at_shopify           | TIMESTAMPTZ   |                       |                          |
| synced_at                    | TIMESTAMPTZ   | DEFAULT now()         |                          |
| created_at                   | TIMESTAMPTZ   | DEFAULT now()         |                          |
| updated_at                   | TIMESTAMPTZ   | DEFAULT now()         |                          |

**Indexes:**

- `idx_customers_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_customers_shop_email` ON (shop_id, email)
- `idx_customers_shop_phone` ON (shop_id, phone) WHERE phone IS NOT NULL
- `idx_customers_tags` GIN ON (tags)

---

### Table: `shopify_metaobjects`

| Column       | Type         | Constraints           | Description          |
| ------------ | ------------ | --------------------- | -------------------- |
| id           | UUID         | PK DEFAULT uuidv7()   |                      |
| shop_id      | UUID         | FK shops(id) NOT NULL |                      |
| shopify_gid  | VARCHAR(100) | NOT NULL              |                      |
| type         | VARCHAR(100) | NOT NULL              | Metaobject type      |
| handle       | VARCHAR(255) | NOT NULL              |                      |
| display_name | TEXT         |                       |                      |
| fields       | JSONB        | NOT NULL              | {key: {type, value}} |
| capabilities | JSONB        | DEFAULT '{}'          |                      |
| synced_at    | TIMESTAMPTZ  | DEFAULT now()         |                      |
| created_at   | TIMESTAMPTZ  | DEFAULT now()         |                      |
| updated_at   | TIMESTAMPTZ  | DEFAULT now()         |                      |

**Indexes:**

- `idx_metaobjects_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_metaobjects_shop_type` ON (shop_id, type)
- `idx_metaobjects_shop_handle` ON (shop_id, type, handle)
- `idx_metaobjects_fields` GIN ON (fields jsonb_path_ops)

---

### Table: `shopify_webhooks`

| Column               | Type         | Constraints           | Description       |
| -------------------- | ------------ | --------------------- | ----------------- |
| id                   | UUID         | PK DEFAULT uuidv7()   |                   |
| shop_id              | UUID         | FK shops(id) NOT NULL |                   |
| shopify_gid          | VARCHAR(100) | NOT NULL              |                   |
| topic                | VARCHAR(100) | NOT NULL              | orders/create etc |
| address              | TEXT         | NOT NULL              | Callback URL      |
| format               | VARCHAR(10)  | DEFAULT 'json'        |                   |
| api_version          | VARCHAR(20)  |                       |                   |
| include_fields       | TEXT[]       |                       |                   |
| metafield_namespaces | TEXT[]       |                       |                   |
| created_at           | TIMESTAMPTZ  | DEFAULT now()         |                   |

**Indexes:**

- `idx_webhooks_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_webhooks_shop_topic` ON (shop_id, topic)

---

### Table: `webhook_events`

> **Purpose:** Async webhook processing queue (F3.3) - Partitioned by month

| Column             | Type             | Constraints            | Description                |
| ------------------ | ---------------- | ---------------------- | -------------------------- |
| id                 | UUID             | DEFAULT uuidv7()       | Event identifier           |
| shop_id            | UUID             | FK shops(id)           | Tenant                     |
| topic              | VARCHAR(100)     | NOT NULL               | orders/create, etc         |
| shopify_webhook_id | VARCHAR(100)     |                        | Original webhook ID        |
| api_version        | VARCHAR(20)      |                        | Shopify API version        |
| payload            | JSONB            | NOT NULL               | Full webhook payload       |
| hmac_verified      | BOOLEAN          | NOT NULL DEFAULT false | HMAC validation passed     |
| received_at        | TIMESTAMPTZ      | DEFAULT now()          | When received              |
| processed_at       | TIMESTAMPTZ      |                        | When processed             |
| processing_error   | TEXT             |                        | Error if failed            |
| job_id             | VARCHAR(255)     |                        | BullMQ job reference       |
| idempotency_key    | VARCHAR(255)     |                        | Deduplication key          |
| retry_count        | INTEGER          | DEFAULT 0              | Processing attempts        |
| created_at         | TIMESTAMPTZ      | NOT NULL DEFAULT now() |                            |
| PRIMARY KEY        | (id, created_at) |                        | Composite for partitioning |

**Partitioning:** `PARTITION BY RANGE (created_at)` - Monthly partitions

**Indexes:**

- `idx_webhook_events_unprocessed` ON (shop_id, received_at) WHERE processed_at IS NULL
- `idx_webhook_events_topic` ON (shop_id, topic)
- `idx_webhook_events_idempotency` UNIQUE ON (idempotency_key) WHERE idempotency_key IS NOT NULL
- `idx_webhook_events_payload` GIN ON (payload jsonb_path_ops)

**RLS Policy:** `webhook_events_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

## Module C: Bulk Operations & Staging

### Table: `bulk_runs`

| Column               | Type         | Constraints                | Description                        |
| -------------------- | ------------ | -------------------------- | ---------------------------------- |
| id                   | UUID         | PK DEFAULT uuidv7()        |                                    |
| shop_id              | UUID         | FK shops(id) NOT NULL      |                                    |
| operation_type       | VARCHAR(50)  | NOT NULL                   | PRODUCTS_EXPORT/ORDERS_EXPORT      |
| query_type           | VARCHAR(50)  |                            | GraphQL query type                 |
| status               | VARCHAR(20)  | NOT NULL DEFAULT 'pending' | pending/running/completed/failed   |
| shopify_operation_id | VARCHAR(100) |                            | Shopify bulk op GID                |
| api_version          | VARCHAR(20)  |                            | Shopify API version used           |
| polling_url          | TEXT         |                            | Bulk operation status URL          |
| result_url           | TEXT         |                            | Signed JSONL download URL (TTL 7d) |
| idempotency_key      | VARCHAR(100) | UNIQUE                     | Prevent duplicates                 |
| cursor_state         | JSONB        |                            | Pagination state                   |
| started_at           | TIMESTAMPTZ  |                            |                                    |
| completed_at         | TIMESTAMPTZ  |                            |                                    |
| records_processed    | INTEGER      | DEFAULT 0                  |                                    |
| bytes_processed      | BIGINT       | DEFAULT 0                  |                                    |
| error_message        | TEXT         |                            |                                    |
| retry_count          | INTEGER      | DEFAULT 0                  |                                    |
| max_retries          | INTEGER      | DEFAULT 3                  |                                    |
| created_at           | TIMESTAMPTZ  | DEFAULT now()              |                                    |
| updated_at           | TIMESTAMPTZ  | DEFAULT now()              |                                    |

**Indexes:**

- `idx_bulk_runs_shop_status` ON (shop_id, status)
- `idx_bulk_runs_shopify_op` ON (shopify_operation_id)
- `idx_bulk_runs_idempotency` UNIQUE ON (idempotency_key)

---

### Table: `bulk_steps`

| Column            | Type         | Constraints                | Description           |
| ----------------- | ------------ | -------------------------- | --------------------- |
| id                | UUID         | PK DEFAULT uuidv7()        |                       |
| bulk_run_id       | UUID         | FK bulk_runs(id) NOT NULL  |                       |
| shop_id           | UUID         | FK shops(id) NOT NULL      |                       |
| step_name         | VARCHAR(100) | NOT NULL                   | download/parse/upsert |
| status            | VARCHAR(20)  | NOT NULL DEFAULT 'pending' |                       |
| started_at        | TIMESTAMPTZ  |                            |                       |
| completed_at      | TIMESTAMPTZ  |                            |                       |
| records_processed | INTEGER      | DEFAULT 0                  |                       |
| error_message     | TEXT         |                            |                       |
| metadata          | JSONB        | DEFAULT '{}'               |                       |
| created_at        | TIMESTAMPTZ  | DEFAULT now()              |                       |

**Indexes:**

- `idx_bulk_steps_run` ON (bulk_run_id)
- `idx_bulk_steps_status` ON (shop_id, status)

---

### Table: `bulk_artifacts`

| Column        | Type        | Constraints               | Description          |
| ------------- | ----------- | ------------------------- | -------------------- |
| id            | UUID        | PK DEFAULT uuidv7()       |                      |
| bulk_run_id   | UUID        | FK bulk_runs(id) NOT NULL |                      |
| shop_id       | UUID        | FK shops(id) NOT NULL     |                      |
| artifact_type | VARCHAR(50) | NOT NULL                  | jsonl/csv            |
| file_path     | TEXT        | NOT NULL                  | Local file path      |
| url           | TEXT        |                           | Shopify download URL |
| bytes_size    | BIGINT      |                           |                      |
| rows_count    | INTEGER     |                           |                      |
| checksum      | VARCHAR(64) |                           | SHA256               |
| expires_at    | TIMESTAMPTZ |                           | URL expiration       |
| created_at    | TIMESTAMPTZ | DEFAULT now()             |                      |

---

### Table: `bulk_errors`

| Column        | Type        | Constraints               | Description         |
| --------------| ----------- | ------------------------- | ------------------- |
| id            | UUID        | PK DEFAULT uuidv7()       |                     |
| bulk_run_id   | UUID        | FK bulk_runs(id) NOT NULL |                     |
| shop_id       | UUID        | FK shops(id) NOT NULL     |                     |
| error_type    | VARCHAR(50) | NOT NULL                  | PARSE/VALIDATION/DB |
| error_code    | VARCHAR(50) |                           |                     |
| error_message | TEXT        | NOT NULL                  |                     |
| line_number   | INTEGER     |                           | JSONL line          |
| payload       | JSONB       |                           | Failed record       |
| created_at    | TIMESTAMPTZ | DEFAULT now()             |                     |

**Indexes:**

- `idx_bulk_errors_run` ON (bulk_run_id)
- `idx_bulk_errors_type` ON (shop_id, error_type)

---

### Table: `staging_products`

> **Structure:** Mirrors `shopify_products` with additional staging columns. Uses UNLOGGED for performance during bulk imports.

| Column                     | Type         | Constraints               | Description                    |
| -------------------------- | ------------ | ------------------------- | ------------------------------ |
| id                         | UUID         | PK DEFAULT uuidv7()       | Staging record ID              |
| bulk_run_id                | UUID         | FK bulk_runs(id) NOT NULL | Source bulk run                |
| shop_id                    | UUID         | FK shops(id) NOT NULL     |                                |
| shopify_gid                | VARCHAR(100) |                           | gid://shopify/Product/123      |
| legacy_resource_id         | BIGINT       |                           | Numeric Shopify ID             |
| title                      | TEXT         |                           | Product title                  |
| handle                     | VARCHAR(255) |                           | URL handle                     |
| description                | TEXT         |                           |                                |
| description_html           | TEXT         |                           |                                |
| vendor                     | VARCHAR(255) |                           |                                |
| product_type               | VARCHAR(255) |                           |                                |
| status                     | VARCHAR(20)  |                           | ACTIVE/DRAFT/ARCHIVED          |
| tags                       | TEXT[]       | DEFAULT '{}'              |                                |
| options                    | JSONB        | DEFAULT '[]'              |                                |
| seo                        | JSONB        |                           |                                |
| metafields                 | JSONB        | DEFAULT '{}'              |                                |
| raw_data                   | JSONB        |                           | Original JSONL row             |
| imported_at                | TIMESTAMPTZ  | DEFAULT now()             |                                |
| validation_status          | VARCHAR(20)  | DEFAULT 'pending'         | pending/valid/invalid          |
| validation_errors          | JSONB        | DEFAULT '[]'              | [{field, error, value}]        |
| merge_status               | VARCHAR(20)  | DEFAULT 'pending'         | pending/merged/skipped/failed  |
| merged_at                  | TIMESTAMPTZ  |                           |                                |
| target_product_id          | UUID         |                           | FK shopify_products after merge|

**Indexes:**

- `idx_staging_products_run` ON (bulk_run_id)
- `idx_staging_products_validation` ON (bulk_run_id, validation_status)
- `idx_staging_products_merge` ON (bulk_run_id, merge_status)
- `idx_staging_products_gid` ON (shop_id, shopify_gid)

**RLS Policy:** `staging_products_policy` - shop_id = current_setting('app.current_shop_id')::uuid

**Note:** Consider using `UNLOGGED` table for staging to improve bulk insert performance.

---

### Table: `staging_variants`

> **Structure:** Mirrors `shopify_variants` with additional staging columns.

| Column                 | Type           | Constraints                         | Description                     |
| ---------------------- | -------------- | ----------------------------------- | ------------------------------- |
| id                     | UUID           | PK DEFAULT uuidv7()                 | Staging record ID               |
| bulk_run_id            | UUID           | FK bulk_runs(id) NOT NULL           | Source bulk run                 |
| shop_id                | UUID           | FK shops(id) NOT NULL               |                                 |
| staging_product_id     | UUID           | FK staging_products(id)             | Parent in staging               |
| shopify_gid            | VARCHAR(100)   |                                     | gid://shopify/ProductVariant/x  |
| legacy_resource_id     | BIGINT         |                                     | Numeric Shopify ID              |
| title                  | VARCHAR(255)   |                                     | Variant title                   |
| sku                    | VARCHAR(255)   |                                     |                                 |
| barcode                | VARCHAR(100)   |                                     |                                 |
| price                  | DECIMAL(12,2)  |                                     |                                 |
| compare_at_price       | DECIMAL(12,2)  |                                     |                                 |
| cost                   | DECIMAL(12,2)  |                                     |                                 |
| inventory_quantity     | INTEGER        |                                     |                                 |
| inventory_item_id      | VARCHAR(100)   |                                     |                                 |
| weight                 | DECIMAL(10,4)  |                                     |                                 |
| weight_unit            | VARCHAR(20)    |                                     |                                 |
| selected_options       | JSONB          | DEFAULT '[]'                        |                                 |
| metafields             | JSONB          | DEFAULT '{}'                        |                                 |
| raw_data               | JSONB          |                                     | Original JSONL row              |
| imported_at            | TIMESTAMPTZ    | DEFAULT now()                       |                                 |
| validation_status      | VARCHAR(20)    | DEFAULT 'pending'                   | pending/valid/invalid           |
| validation_errors      | JSONB          | DEFAULT '[]'                        | [{field, error, value}]         |
| merge_status           | VARCHAR(20)    | DEFAULT 'pending'                   | pending/merged/skipped/failed   |
| merged_at              | TIMESTAMPTZ    |                                     |                                 |
| target_variant_id      | UUID           |                                     | FK shopify_variants after merge |

**Indexes:**

- `idx_staging_variants_run` ON (bulk_run_id)
- `idx_staging_variants_product` ON (staging_product_id)
- `idx_staging_variants_validation` ON (bulk_run_id, validation_status)
- `idx_staging_variants_gid` ON (shop_id, shopify_gid)

**RLS Policy:** `staging_variants_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

## Module D: Global PIM

### Table: `prod_taxonomy`

| Column              | Type         | Constraints          | Description                 |
| ------------------- | ------------ | ---------------------| --------------------------- |
| id                  | UUID         | PK DEFAULT uuidv7()  |                             |
| parent_id           | UUID         | FK prod_taxonomy(id) |                             |
| name                | VARCHAR(255) | NOT NULL             | Category name               |
| slug                | VARCHAR(255) | NOT NULL UNIQUE      | URL-safe slug               |
| breadcrumbs         | TEXT[]       |                      | Full path array             |
| level               | INTEGER      | NOT NULL DEFAULT 0   | Depth in tree               |
| attribute_schema    | JSONB        | DEFAULT '{}'         | Required attributes         |
| validation_rules    | JSONB        | DEFAULT '{}'         |                             |
| external_mappings   | JSONB        | DEFAULT '{}'         | {shopify, google, facebook} |
| shopify_taxonomy_id | VARCHAR(100) |                      | Shopify category ID         |
| is_active           | BOOLEAN      | DEFAULT true         |                             |
| sort_order          | INTEGER      | DEFAULT 0            |                             |
| created_at          | TIMESTAMPTZ  | DEFAULT now()        |                             |
| updated_at          | TIMESTAMPTZ  | DEFAULT now()        |                             |

**Indexes:**

- `idx_taxonomy_parent` ON (parent_id)
- `idx_taxonomy_slug` UNIQUE ON (slug)
- `idx_taxonomy_shopify` ON (shopify_taxonomy_id)
- `idx_taxonomy_breadcrumbs` GIN ON (breadcrumbs)

---

### Table: `prod_sources`

| Column          | Type         | Constraints         | Description                   |
| --------------- | ------------ | ------------------- | ----------------------------- |
| id              | UUID         | PK DEFAULT uuidv7() |                               |
| name            | VARCHAR(100) | NOT NULL UNIQUE     | Source name                   |
| source_type     | VARCHAR(50)  | NOT NULL            | SUPPLIER/MANUFACTURER/SCRAPER |
| base_url        | TEXT         |                     |                               |
| priority        | INTEGER      | DEFAULT 50          | Conflict resolution           |
| trust_score     | DECIMAL(3,2) | DEFAULT 0.5         | 0.0-1.0                       |
| config          | JSONB        | DEFAULT '{}'        | Scraper config                |
| rate_limit      | JSONB        |                     | {requests_per_second}         |
| auth_config     | JSONB        |                     | Encrypted credentials ref     |
| is_active       | BOOLEAN      | DEFAULT true        |                               |
| last_harvest_at | TIMESTAMPTZ  |                     |                               |
| created_at      | TIMESTAMPTZ  | DEFAULT now()       |                               |
| updated_at      | TIMESTAMPTZ  | DEFAULT now()       |                               |

---

### Table: `prod_raw_harvest`

| Column            | Type         | Constraints                  | Description              |
| ----------------- | ------------ | ---------------------------- | ------------------------ |
| id                | UUID         | PK DEFAULT uuidv7()          |                          |
| source_id         | UUID         | FK prod_sources(id) NOT NULL |                          |
| target_sku        | VARCHAR(100) |                              | Matched SKU if known     |
| source_url        | TEXT         | NOT NULL                     | Scraped URL              |
| source_product_id | VARCHAR(255) |                              | External product ID      |
| raw_html          | TEXT         |                              | Full HTML                |
| raw_json          | JSONB        |                              | Structured data          |
| http_status       | INTEGER      |                              | Response code            |
| response_headers  | JSONB        |                              |                          |
| fetched_at        | TIMESTAMPTZ  | DEFAULT now()                |                          |
| processing_status | VARCHAR(20)  | DEFAULT 'pending'            | pending/processed/failed |
| processing_error  | TEXT         |                              |                          |
| processed_at      | TIMESTAMPTZ  |                              |                          |
| content_hash      | VARCHAR(64)  |                              | SHA256 for dedup         |
| ttl_expires_at    | TIMESTAMPTZ  |                              | Cache expiration         |
| created_at        | TIMESTAMPTZ  | DEFAULT now()                |                          |

**Indexes:**

- `idx_harvest_source` ON (source_id)
- `idx_harvest_status` ON (processing_status)
- `idx_harvest_sku` ON (target_sku) WHERE target_sku IS NOT NULL
- `idx_harvest_url` ON (source_url)
- `idx_harvest_hash` ON (content_hash)

**Partitioning:** PARTITION BY RANGE (fetched_at) - monthly partitions

---

### Table: `prod_extraction_sessions`

| Column             | Type         | Constraints                      | Description          |
| ------------------ | ------------ | -------------------------------- | -------------------- |
| id                 | UUID         | PK DEFAULT uuidv7()              |                      |
| harvest_id         | UUID         | FK prod_raw_harvest(id) NOT NULL |                      |
| agent_version      | VARCHAR(50)  | NOT NULL                         | AI model version     |
| model_name         | VARCHAR(100) |                                  | gpt-4o/gemini-pro    |
| extracted_specs    | JSONB        | NOT NULL                         | {key: value} pairs   |
| grounding_snippets | JSONB        |                                  | Source text evidence |
| confidence_score   | DECIMAL(3,2) |                                  | 0.0-1.0 overall      |
| field_confidences  | JSONB        |                                  | Per-field scores     |
| tokens_used        | INTEGER      |                                  | API tokens consumed  |
| latency_ms         | INTEGER      |                                  | Processing time      |
| error_message      | TEXT         |                                  |                      |
| created_at         | TIMESTAMPTZ  | DEFAULT now()                    |                      |

**Indexes:**

- `idx_extraction_harvest` ON (harvest_id)
- `idx_extraction_confidence` ON (confidence_score)
- `idx_extraction_specs` GIN ON (extracted_specs jsonb_path_ops)

---

### Table: `prod_master`

| Column            | Type         | Constraints          | Description               |
| ------------------| ------------ | ---------------------| --------------------------|
| id                | UUID         | PK DEFAULT uuidv7()  | Golden record ID          |
| internal_sku      | VARCHAR(100) | UNIQUE NOT NULL      | Master SKU                |
| canonical_title   | TEXT         | NOT NULL             | Resolved title            |
| brand             | VARCHAR(255) |                      |                           |
| manufacturer      | VARCHAR(255) |                      |                           |
| mpn               | VARCHAR(100) |                      | Manufacturer part #       |
| gtin              | VARCHAR(14)  |                      | Global Trade Item #       |
| taxonomy_id       | UUID         | FK prod_taxonomy(id) |                           |
| dedupe_status     | VARCHAR(20)  | DEFAULT 'unique'     | unique/merged/duplicate   |
| dedupe_cluster_id | UUID         |                      | Cluster reference         |
| primary_source_id | UUID         | FK prod_sources(id)  |                           |
| lifecycle_status    | VARCHAR(20)  | DEFAULT 'active'     | active/discontinued/draft |
| data_quality_level  | VARCHAR(20)  | NOT NULL DEFAULT 'bronze' CHECK (data_quality_level IN ('bronze', 'silver', 'golden', 'review_needed')) | PIM maturity stage |
| quality_score       | DECIMAL(3,2) |                      | 0.0-1.0 computed score    |
| quality_score_breakdown | JSONB    | DEFAULT '{}'         | {completeness, accuracy, consistency} |
| last_quality_check  | TIMESTAMPTZ  |                      | When quality was last evaluated |
| promoted_to_silver_at | TIMESTAMPTZ |                     | Timestamp of silver promotion |
| promoted_to_golden_at | TIMESTAMPTZ |                     | Timestamp of golden promotion |
| needs_review        | BOOLEAN      | DEFAULT false        |                           |
| review_notes        | TEXT         |                      |                           |
| created_at          | TIMESTAMPTZ  | DEFAULT now()        |                           |
| updated_at          | TIMESTAMPTZ  | DEFAULT now()        |                           |

**Indexes:**

- `idx_master_sku` UNIQUE ON (internal_sku)
- `idx_master_brand` ON (brand)
- `idx_master_taxonomy` ON (taxonomy_id)
- `idx_master_gtin` ON (gtin) WHERE gtin IS NOT NULL
- `idx_master_mpn` ON (manufacturer, mpn)
- `idx_master_review` ON (needs_review) WHERE needs_review = true
- `idx_master_quality_level` ON (data_quality_level)
- `idx_master_bronze` ON (id) WHERE data_quality_level = 'bronze'
- `idx_master_silver` ON (id) WHERE data_quality_level = 'silver'
- `idx_master_golden` ON (id) WHERE data_quality_level = 'golden'

---

### Table: `prod_specs_normalized`

| Column        | Type           | Constraints                 | Description                           |
| --------------| -------------- | --------------------------- | ------------------------------------- |
| id            | UUID           | PK DEFAULT uuidv7()         |                                       |
| product_id    | UUID           | FK prod_master(id) NOT NULL |                                       |
| specs         | JSONB          | NOT NULL                    | {attr_code: {value, unit}}            |
| raw_specs     | JSONB          |                             | Original before normalization         |
| provenance    | JSONB          | NOT NULL                    | {source_id, extraction_id, timestamp} |
| version       | INTEGER        | NOT NULL DEFAULT 1          | Spec version                          |
| is_current    | BOOLEAN        | DEFAULT true                | Latest version                        |
| needs_review  | BOOLEAN        | DEFAULT false               |                                       |
| review_reason | VARCHAR(100)   |                             |                                       |
| created_at    | TIMESTAMPTZ    | DEFAULT now()               |                                       |
| updated_at    | TIMESTAMPTZ    | DEFAULT now()               |                                       |

**Indexes:**

- `idx_specs_product` ON (product_id)
- `idx_specs_current` ON (product_id) WHERE is_current = true
- `idx_specs_data` GIN ON (specs jsonb_path_ops)
- `idx_specs_review` ON (needs_review) WHERE needs_review = true

---

### Table: `prod_semantics`

| Column             | Type         | Constraints           | Description          |
| ------------------ | ------------ | --------------------- | -------------------- |
| product_id         | UUID         | PK FK prod_master(id) |                      |
| title_master       | TEXT         | NOT NULL              | SEO-optimized title  |
| description_master | TEXT         |                       | Long description     |
| description_short  | VARCHAR(500) |                       | Summary              |
| ai_summary         | TEXT         |                       | AI-generated summary |
| keywords           | TEXT[]       |                       | Search keywords      |
| keywords_graph     | JSONB        |                       | Related terms graph  |
| json_ld_schema     | JSONB        |                       | Schema.org Product   |
| search_vector      | TSVECTOR     |                       | Full-text search     |
| locale             | VARCHAR(10)  | DEFAULT 'ro'          |                      |
| updated_at         | TIMESTAMPTZ  | DEFAULT now()         |                      |

**Indexes:**

- `idx_semantics_fts` GIN ON (search_vector)
- `idx_semantics_keywords` GIN ON (keywords)

---

### Table: `prod_channel_mappings`

| Column         | Type         | Constraints                 | Description             |
| -------------- | ------------ | --------------------------- | ----------------------- |
| id             | UUID         | PK DEFAULT uuidv7()         |                         |
| product_id     | UUID         | FK prod_master(id) NOT NULL | Target product          |
| channel        | VARCHAR(50)  | NOT NULL                    | shopify/google/facebook |
| shop_id        | UUID         | FK shops(id)                | For Shopify channel     |
| external_id    | VARCHAR(255) | NOT NULL                    | Channel product ID      |
| sync_status    | VARCHAR(20)  | DEFAULT 'pending'           | pending/synced/error    |
| last_pushed_at | TIMESTAMPTZ  |                             |                         |
| last_pulled_at | TIMESTAMPTZ  |                             |                         |
| channel_meta   | JSONB        | DEFAULT '{}'                | Channel-specific data   |
| error_message  | TEXT         |                             |                         |
| created_at     | TIMESTAMPTZ  | DEFAULT now()               |                         |
| updated_at     | TIMESTAMPTZ  | DEFAULT now()               |                         |

**Indexes:**

- `idx_channel_product` ON (product_id)
- `idx_channel_external` UNIQUE ON (channel, shop_id, external_id)
- `idx_channel_status` ON (channel, sync_status)

---

## Module D Additions: PIM Consensus & Deduplication

> **Adăugare la Module D:** Tabele pentru voting layer și clustering semantic

### Table: `prod_proposals`

| Column                | Type           | Constraints                     | Description                                 |
| --------------------- | -------------- | ------------------------------- | ------------------------------------------- |
| id                    | UUID           | PK DEFAULT uuidv7()             |                                             |
| product_id            | UUID           | FK prod_master(id) NOT NULL     | Target product                              |
| field_path            | TEXT           | NOT NULL                        | JSON path: 'specs.weight_kg'                |
| current_value         | JSONB          |                                 | Existing value                              |
| proposed_value        | JSONB          | NOT NULL                        | New proposed value                          |
| extraction_session_id | UUID           | FK prod_extraction_sessions(id) | Source extraction                           |
| source_id             | UUID           | FK prod_sources(id)             | Source reference                            |
| confidence_score      | DECIMAL(3,2)   |                                 | 0.0-1.0                                     |
| proposal_status       | VARCHAR(20)    | DEFAULT 'pending'               | pending/approved/rejected/merged/superseded |
| priority              | INTEGER        | DEFAULT 0                       | Higher = more urgent                        |
| reviewed_by           | UUID           | FK staff_users(id)              |                                             |
| reviewed_at           | TIMESTAMPTZ    |                                 |                                             |
| review_notes          | TEXT           |                                 |                                             |
| auto_approved         | BOOLEAN        | DEFAULT false                   | AI auto-approval                            |
| expires_at            | TIMESTAMPTZ    |                                 | Auto-reject deadline                        |
| created_at            | TIMESTAMPTZ    | DEFAULT now()                   |                                             |
| updated_at            | TIMESTAMPTZ    | DEFAULT now()                   |                                             |

**Indexes:**

- `idx_proposals_product` ON (product_id, proposal_status)
- `idx_proposals_pending` ON (proposal_status, priority DESC) WHERE proposal_status = 'pending'
- `idx_proposals_field` ON (product_id, field_path)
- `idx_proposals_source` ON (source_id)
- `idx_proposals_expires` ON (expires_at) WHERE proposal_status = 'pending'

---

### Table: `prod_dedupe_clusters`

| Column               | Type         | Constraints         | Description                       |
| -------------------- | ------------ | ------------------- | --------------------------------- |
| id                   | UUID         | PK DEFAULT uuidv7() |                                   |
| cluster_type         | VARCHAR(30)  | NOT NULL            | EXACT_MATCH/FUZZY/SEMANTIC        |
| match_criteria       | JSONB        | NOT NULL            | {fields, thresholds}              |
| canonical_product_id | UUID         | FK prod_master(id)  | Golden record                     |
| member_count         | INTEGER      | DEFAULT 1           | Number of products                |
| confidence_score     | DECIMAL(3,2) |                     | Average similarity                |
| status               | VARCHAR(20)  | DEFAULT 'pending'   | pending/confirmed/rejected/merged |
| reviewed_by          | UUID         | FK staff_users(id)  |                                   |
| reviewed_at          | TIMESTAMPTZ  |                     |                                   |
| created_at           | TIMESTAMPTZ  | DEFAULT now()       |                                   |
| updated_at           | TIMESTAMPTZ  | DEFAULT now()       |                                   |

**Indexes:**

- `idx_clusters_canonical` ON (canonical_product_id)
- `idx_clusters_status` ON (status, confidence_score DESC)
- `idx_clusters_type` ON (cluster_type, status)

---

### Table: `prod_dedupe_cluster_members`

| Column           | Type           | Constraints                          | Description               |
| ---------------- | -------------- | ------------------------------------ | ------------------------- |
| cluster_id       | UUID           | FK prod_dedupe_clusters(id) NOT NULL |                           |
| product_id       | UUID           | FK prod_master(id) NOT NULL          |                           |
| similarity_score | DECIMAL(5,4)   |                                      | Similarity to canonical   |
| match_fields     | JSONB          |                                      | Which fields matched      |
| is_canonical     | BOOLEAN        | DEFAULT false                        | Is this the golden record |
| created_at       | TIMESTAMPTZ    | DEFAULT now()                        |                           |
| updated_at       | TIMESTAMPTZ    | DEFAULT now()                        |                           |

**Primary Key:** (cluster_id, product_id)

**Indexes:**

- `idx_cluster_members_product` ON (product_id)
- `idx_cluster_members_similarity` ON (cluster_id, similarity_score DESC)

**Note:** No RLS - PIM is global data, access controlled at application layer.

---

### Table: `prod_similarity_matches`

> **Purpose:** Store external product matches from broad search/research (Google, suppliers, web scraping) for 95-100% similarity validation

| Column               | Type           | Constraints                            | Description                              |
| -------------------- | -------------- | -------------------------------------- | ---------------------------------------- |
| id                   | UUID           | PK DEFAULT uuidv7()                    |                                          |
| product_id           | UUID           | FK prod_master(id) NOT NULL            | Our internal product                     |
| source_id            | UUID           | FK prod_sources(id)                    | Where the match was found                |
| source_url           | TEXT           | NOT NULL                               | URL of external product page             |
| source_product_id    | VARCHAR(255)   |                                        | External product ID (ASIN, eMag ID)      |
| source_gtin          | VARCHAR(14)    |                                        | GTIN from external source                |
| source_title         | TEXT           |                                        | Title from external source               |
| source_brand         | VARCHAR(255)   |                                        | Brand from external source               |
| source_price         | DECIMAL(12,2)  |                                        | Price from external source               |
| source_currency      | VARCHAR(3)     |                                        | Currency code                            |
| similarity_score     | DECIMAL(5,4)   | NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1) | 0.95-1.00 for valid matches |
| match_method         | VARCHAR(30)    | NOT NULL                               | gtin_exact/vector_semantic/title_fuzzy/mpn_exact |
| match_confidence     | VARCHAR(20)    | DEFAULT 'pending'                      | pending/confirmed/rejected/uncertain     |
| match_details        | JSONB          | DEFAULT '{}'                           | {matched_fields, scores_breakdown}       |
| extraction_session_id| UUID           | FK prod_extraction_sessions(id)        | If specs were extracted                  |
| specs_extracted      | JSONB          |                                        | Specs harvested from this source         |
| scraped_at           | TIMESTAMPTZ    |                                        | When the source was scraped              |
| validated_at         | TIMESTAMPTZ    |                                        | When human/AI validated                  |
| validated_by         | UUID           | FK staff_users(id)                     | Who validated (if human)                 |
| validation_notes     | TEXT           |                                        |                                          |
| is_primary_source    | BOOLEAN        | DEFAULT false                          | Is this the best match for enrichment    |
| created_at           | TIMESTAMPTZ    | DEFAULT now()                          |                                          |
| updated_at           | TIMESTAMPTZ    | DEFAULT now()                          |                                          |

**Indexes:**

- `idx_similarity_product` ON (product_id)
- `idx_similarity_source` ON (source_id)
- `idx_similarity_gtin` ON (source_gtin) WHERE source_gtin IS NOT NULL
- `idx_similarity_score` ON (similarity_score DESC) WHERE similarity_score >= 0.95
- `idx_similarity_method` ON (match_method, match_confidence)
- `idx_similarity_pending` ON (match_confidence) WHERE match_confidence = 'pending'
- `idx_similarity_confirmed` ON (product_id, is_primary_source) WHERE match_confidence = 'confirmed'
- `idx_similarity_url` ON (source_url)

**Note:** No RLS - PIM is global data, access controlled at application layer.

---

### Table: `prod_quality_events`

> **Purpose:** Track quality level changes for audit trail and notifications (Gap #5)

| Column             | Type         | Constraints                    | Description                           |
| ------------------ | ------------ | ------------------------------ | ------------------------------------- |
| id                 | UUID         | PK DEFAULT uuidv7()            |                                       |
| product_id         | UUID         | FK prod_master(id) NOT NULL    |                                       |
| event_type         | VARCHAR(50)  | NOT NULL                       | quality_promoted/quality_demoted/review_requested |
| previous_level     | VARCHAR(20)  |                                | bronze/silver/golden                  |
| new_level          | VARCHAR(20)  | NOT NULL                       | bronze/silver/golden/review_needed    |
| quality_score_before | DECIMAL(3,2) |                              |                                       |
| quality_score_after  | DECIMAL(3,2) |                              |                                       |
| trigger_reason     | VARCHAR(100) | NOT NULL                       | auto_enrichment/manual_review/data_change/scheduled_check |
| trigger_details    | JSONB        | DEFAULT '{}'                   | {changed_fields, enrichment_source}   |
| triggered_by       | UUID         | FK staff_users(id)             | NULL if automated                     |
| job_id             | VARCHAR(255) |                                | BullMQ job reference if async         |
| webhook_sent       | BOOLEAN      | DEFAULT false                  | Was notification sent                 |
| webhook_sent_at    | TIMESTAMPTZ  |                                |                                       |
| created_at         | TIMESTAMPTZ  | DEFAULT now()                  |                                       |

**Indexes:**

- `idx_quality_events_product` ON (product_id, created_at DESC)
- `idx_quality_events_type` ON (event_type, created_at DESC)
- `idx_quality_events_level` ON (new_level, created_at DESC)
- `idx_quality_events_pending_webhook` ON (created_at) WHERE webhook_sent = false

**Note:** No RLS - PIM is global data.

---

### Table: `prod_translations`

| Column             | Type         | Constraints                  | Description            |
| ------------------ | ------------ | ---------------------------- | ---------------------- |
| id                 | UUID         | PK DEFAULT uuidv7()          |                        |
| product_id         | UUID         | FK prod_master(id) NOT NULL  |                        |
| locale             | VARCHAR(10)  | NOT NULL                     | en/ro/de/fr etc        |
| title              | TEXT         |                              | Translated title       |
| description        | TEXT         |                              | Translated description |
| description_short  | VARCHAR(500) |                              |                        |
| keywords           | TEXT[]       |                              | Localized keywords     |
| seo_title          | VARCHAR(255) |                              |                        |
| seo_description    | TEXT         |                              |                        |
| translation_source | VARCHAR(30)  |                              | manual/ai/import       |
| quality_score      | DECIMAL(3,2) |                              | Translation quality    |
| is_approved        | BOOLEAN      | DEFAULT false                |                        |
| created_at         | TIMESTAMPTZ  | DEFAULT now()                |                        |
| updated_at         | TIMESTAMPTZ  | DEFAULT now()                |                        |

**Indexes:**

- `idx_translations_product_locale` UNIQUE ON (product_id, locale)
- `idx_translations_locale` ON (locale, is_approved)

---

## Module E: Attribute Normalization & Vectors

### Table: `prod_attr_definitions`

| Column           | Type         | Constraints         | Description                |
| ---------------- | ------------ | ------------------- | -------------------------- |
| id               | UUID         | PK DEFAULT uuidv7() |                            |
| code             | VARCHAR(100) | UNIQUE NOT NULL     | Canonical attr code        |
| label            | VARCHAR(255) | NOT NULL            | Display label              |
| description      | TEXT         |                     |                            |
| data_type        | VARCHAR(30)  | NOT NULL            | string/number/boolean/enum |
| unit             | VARCHAR(50)  |                     | Default unit               |
| unit_family      | VARCHAR(50)  |                     | length/weight/volume       |
| allowed_values   | JSONB        |                     | Enum values                |
| validation_regex | VARCHAR(255) |                     | Input validation           |
| is_required      | BOOLEAN      | DEFAULT false       |                            |
| is_variant_level | BOOLEAN      | DEFAULT false       |                            |
| is_searchable    | BOOLEAN      | DEFAULT true        |                            |
| is_filterable    | BOOLEAN      | DEFAULT true        |                            |
| display_order    | INTEGER      | DEFAULT 0           |                            |
| embedding        | VECTOR(1536) |                     | Semantic embedding         |
| created_at       | TIMESTAMPTZ  | DEFAULT now()       |                            |
| updated_at       | TIMESTAMPTZ  | DEFAULT now()       |                            |

**Indexes:**

- `idx_attr_code` UNIQUE ON (code)
- `idx_attr_type` ON (data_type)
- `idx_attr_embedding` USING hnsw (embedding vector_cosine_ops)

---

### Table: `prod_attr_synonyms`

| Column           | Type         | Constraints                           | Description       |
| ---------------- | ------------ | ------------------------------------- | ----------------- |
| id               | UUID         | PK DEFAULT uuidv7()                   |                   |
| definition_id    | UUID         | FK prod_attr_definitions(id) NOT NULL |                   |
| synonym_text     | VARCHAR(255) | NOT NULL                              | Alternate name    |
| locale           | VARCHAR(10)  | DEFAULT 'ro'                          |                   |
| source           | VARCHAR(50)  |                                       | manual/ai/import  |
| confidence_score | DECIMAL(3,2) | DEFAULT 1.0                           |                   |
| is_approved      | BOOLEAN      | DEFAULT false                         |                   |
| created_at       | TIMESTAMPTZ  | DEFAULT now()                         |                   |

**Indexes:**

- `idx_synonyms_definition` ON (definition_id)
- `idx_synonyms_text` ON (synonym_text)
- `idx_synonyms_text_trgm` USING gin (synonym_text gin_trgm_ops)

---

### Table: `prod_embeddings`

| Column         | Type         | Constraints                 | Description                      |
| -------------- | ------------ | --------------------------- | -------------------------------- |
| id             | UUID         | PK DEFAULT uuidv7()         |                                  |
| product_id     | UUID         | FK prod_master(id) NOT NULL |                                  |
| embedding_type | VARCHAR(50)  | NOT NULL                    | title/description/specs/combined |
| embedding      | VECTOR(1536) | NOT NULL                    | OpenAI ada-002                   |
| content_hash   | VARCHAR(64)  | NOT NULL                    | Source content hash              |
| model_version  | VARCHAR(50)  | NOT NULL                    | text-embedding-3-small           |
| dimensions     | INTEGER      | DEFAULT 1536                |                                  |
| created_at     | TIMESTAMPTZ  | DEFAULT now()               |                                  |

**Indexes:**

- `idx_embeddings_product` ON (product_id)
- `idx_embeddings_type` ON (product_id, embedding_type)
- `idx_embeddings_vector` USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)

---

### Table: `shop_product_embeddings`

> **Per-tenant vector search** (conform F6.1.1) - separat de `prod_embeddings` (PIM global)

| Column         | Type         | Constraints                      | Description                      |
| -------------- | ------------ | -------------------------------- | -------------------------------- |
| id             | UUID         | PK DEFAULT uuidv7()              |                                  |
| shop_id        | UUID         | FK shops(id) NOT NULL            | Tenant isolation                 |
| product_id     | UUID         | FK shopify_products(id) NOT NULL | Shop product ref                 |
| embedding_type | VARCHAR(50)  | NOT NULL                         | title/description/combined       |
| embedding      | VECTOR(1536) | NOT NULL                         | OpenAI embedding                 |
| content_hash   | VARCHAR(64)  | NOT NULL                         | For change detection             |
| model_version  | VARCHAR(50)  | NOT NULL                         | text-embedding-3-small           |
| dimensions     | INTEGER      | DEFAULT 1536                     |                                  |
| status         | VARCHAR(20)  | DEFAULT 'pending'                | pending/ready/failed             |
| error_message  | TEXT         |                                  |                                  |
| generated_at   | TIMESTAMPTZ  |                                  | When embedding was generated     |
| created_at     | TIMESTAMPTZ  | DEFAULT now()                    |                                  |
| updated_at     | TIMESTAMPTZ  | DEFAULT now()                    |                                  |

**Indexes:**

- `idx_shop_embeddings_product` UNIQUE ON (shop_id, product_id, embedding_type, model_version)
- `idx_shop_embeddings_hash` ON (shop_id, content_hash)
- `idx_shop_embeddings_pending` ON (shop_id, status) WHERE status = 'pending'
- `idx_shop_embeddings_vector` USING hnsw (embedding vector_cosine_ops) WITH (m=24, ef_construction=128)

**RLS Policy:** `shop_embeddings_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

## Module F: AI Batch Processing

### Table: `ai_batches`

| Column            | Type          | Constraints                | Description                                   |
| ----------------- | ------------- | -------------------------- | --------------------------------------------- |
| id                | UUID          | PK DEFAULT uuidv7()        |                                               |
| shop_id           | UUID          | FK shops(id)               | Optional shop scope                           |
| provider          | VARCHAR(20)   | NOT NULL                   | openai/anthropic                              |
| provider_batch_id | VARCHAR(100)  |                            | External batch ID                             |
| batch_type        | VARCHAR(50)   | NOT NULL                   | embedding/extraction/enrichment               |
| status            | VARCHAR(20)   | DEFAULT 'pending'          | pending/submitted/processing/completed/failed |
| request_count     | INTEGER       | NOT NULL DEFAULT 0         |                                               |
| completed_count   | INTEGER       | DEFAULT 0                  |                                               |
| error_count       | INTEGER       | DEFAULT 0                  |                                               |
| total_tokens      | INTEGER       | DEFAULT 0                  |                                               |
| estimated_cost    | DECIMAL(10,4) |                            |                                               |
| submitted_at      | TIMESTAMPTZ   |                            |                                               |
| completed_at      | TIMESTAMPTZ   |                            |                                               |
| expires_at        | TIMESTAMPTZ   |                            | Result expiration                             |
| error_message     | TEXT          |                            |                                               |
| created_at        | TIMESTAMPTZ   | DEFAULT now()              |                                               |
| updated_at        | TIMESTAMPTZ   | DEFAULT now()              |                                               |

**Indexes:**

- `idx_ai_batches_provider` ON (provider_batch_id)
- `idx_ai_batches_status` ON (status)
- `idx_ai_batches_shop` ON (shop_id)

---

### Table: `ai_batch_items`

| Column         | Type         | Constraints                | Description          |
| -------------- | ------------ | -------------------------- | -------------------- |
| id             | UUID         | PK DEFAULT uuidv7()        |                      |
| batch_id       | UUID         | FK ai_batches(id) NOT NULL |                      |
| shop_id        | UUID         | FK shops(id)               |                      |
| entity_type    | VARCHAR(50)  | NOT NULL                   | product/harvest/spec |
| entity_id      | UUID         | NOT NULL                   | Reference ID         |
| custom_id      | VARCHAR(100) |                            | Provider custom ID   |
| input_content  | TEXT         | NOT NULL                   | Request content      |
| content_hash   | VARCHAR(64)  | NOT NULL                   | Dedup hash           |
| status         | VARCHAR(20)  | DEFAULT 'pending'          |                      |
| output_content | TEXT         |                            | Response             |
| tokens_used    | INTEGER      |                            |                      |
| error_message  | TEXT         |                            |                      |
| processed_at   | TIMESTAMPTZ  |                            |                      |
| created_at     | TIMESTAMPTZ  | DEFAULT now()              |                      |

**Indexes:**

- `idx_batch_items_batch` ON (batch_id)
- `idx_batch_items_entity` ON (entity_type, entity_id)
- `idx_batch_items_hash` ON (content_hash)
- `idx_batch_items_status` ON (batch_id, status)

---

### Table: `embedding_batches`

> **Purpose:** OpenAI Batch Embeddings API tracking (F6.1) - Specific to embedding workflows

| Column          | Type          | Constraints                               | Description                                                |
| --------------- | ------------- | ----------------------------------------- | ---------------------------------------------------------- |
| id              | UUID          | PK DEFAULT uuidv7()                       | Batch identifier                                           |
| shop_id         | UUID          | FK shops(id)                              | Optional shop scope                                        |
| batch_type      | VARCHAR(30)   | NOT NULL CHECK IN (...)                   | product_title/product_description/specs/combined/attribute |
| status          | VARCHAR(20)   | NOT NULL DEFAULT 'pending'                | pending/submitted/processing/completed/failed/cancelled    |
| openai_batch_id | VARCHAR(100)  |                                           | External OpenAI batch ID                                   |
| input_file_id   | VARCHAR(100)  |                                           | OpenAI file ID for input                                   |
| output_file_id  | VARCHAR(100)  |                                           | OpenAI file ID for output                                  |
| error_file_id   | VARCHAR(100)  |                                           | OpenAI file ID for errors                                  |
| model           | VARCHAR(50)   | NOT NULL DEFAULT 'text-embedding-3-small' | Embedding model                                            |
| dimensions      | INTEGER       | NOT NULL DEFAULT 1536                     | Vector dimensions                                          |
| total_items     | INTEGER       | NOT NULL DEFAULT 0                        | Items in batch                                             |
| completed_items | INTEGER       | DEFAULT 0                                 | Successfully completed                                     |
| failed_items    | INTEGER       | DEFAULT 0                                 | Failed items                                               |
| tokens_used     | INTEGER       | DEFAULT 0                                 | Total tokens consumed                                      |
| estimated_cost  | DECIMAL(10,4) |                                           | USD cost estimate                                          |
| submitted_at    | TIMESTAMPTZ   |                                           | When submitted to OpenAI                                   |
| completed_at    | TIMESTAMPTZ   |                                           | When processing finished                                   |
| expires_at      | TIMESTAMPTZ   |                                           | OpenAI result expiration                                   |
| error_message   | TEXT          |                                           | Error details if failed                                    |
| created_at      | TIMESTAMPTZ   | DEFAULT now()                             |                                                            |
| updated_at      | TIMESTAMPTZ   | DEFAULT now()                             |                                                            |

**Indexes:**

- `idx_embedding_batches_shop` ON (shop_id)
- `idx_embedding_batches_status` ON (status)
- `idx_embedding_batches_openai` ON (openai_batch_id) WHERE openai_batch_id IS NOT NULL

**RLS Policy:** `embedding_batches_policy` - shop_id IS NULL OR shop_id = current_setting('app.current_shop_id')::uuid

---

## Module G: Queue & Job Tracking

### Table: `job_runs`

| Column        | Type         | Constraints         | Description                     |
| ------------- | ------------ | ------------------- | ------------------------------- |
| id            | UUID         | PK DEFAULT uuidv7() |                                 |
| shop_id       | UUID         | FK shops(id)        |                                 |
| queue_name    | VARCHAR(100) | NOT NULL            | BullMQ queue                    |
| job_id        | VARCHAR(255) | NOT NULL            | BullMQ job ID                   |
| job_name      | VARCHAR(100) | NOT NULL            | Job type                        |
| status        | VARCHAR(20)  | NOT NULL            | waiting/active/completed/failed |
| priority      | INTEGER      | DEFAULT 0           |                                 |
| attempts      |  INTEGER     | DEFAULT 0           |                                 |
| max_attempts  | INTEGER      | DEFAULT 3           |                                 |
| payload       | JSONB        | NOT NULL            | Job data                        |
| result        | JSONB        |                     | Job result                      |
| error_message | TEXT         |                     |                                 |
| error_stack   | TEXT         |                     |                                 |
| started_at    | TIMESTAMPTZ  |                     |                                 |
| completed_at  | TIMESTAMPTZ  |                     |                                 |
| failed_at     | TIMESTAMPTZ  |                     |                                 |
| created_at    | TIMESTAMPTZ  | DEFAULT now()       |                                 |

**Indexes:**

- `idx_jobs_queue` ON (queue_name, status)
- `idx_jobs_shop` ON (shop_id, status)
- `idx_jobs_bullmq` ON (queue_name, job_id)

---

### Table: `scheduled_tasks`

| Column          | Type         | Constraints         | Description  |
| --------------- | ------------ | ------------------- | ------------ |
| id              | UUID         | PK DEFAULT uuidv7() |              |
| shop_id         | UUID         | FK shops(id)        |              |
| task_name       | VARCHAR(100) | NOT NULL            |              |
| cron_expression | VARCHAR(100) | NOT NULL            |              |
| queue_name      | VARCHAR(100) | NOT NULL            | Target queue |
| job_data        | JSONB        | DEFAULT '{}'        |              |
| is_active       | BOOLEAN      | DEFAULT true        |              |
| last_run_at     | TIMESTAMPTZ  |                     |              |
| next_run_at     | TIMESTAMPTZ  |                     |              |
| run_count       | INTEGER      | DEFAULT 0           |              |
| error_count     | INTEGER      | DEFAULT 0           |              |
| created_at      | TIMESTAMPTZ  | DEFAULT now()       |              |
| updated_at      | TIMESTAMPTZ  | DEFAULT now()       |              |

---

### Table: `rate_limit_buckets`

> **Purpose:** Token bucket persistence for distributed rate limiting (F4.3)

| Column                | Type          | Constraints            | Description.        |
| --------------------- | ------------- | ---------------------- | ------------------- |
| shop_id               | UUID          | PK FK shops(id)        | One bucket per shop |
| tokens_remaining      | DECIMAL(10,2) | NOT NULL DEFAULT 1000  | Current tokens      |
| max_tokens            | DECIMAL(10,2) | NOT NULL DEFAULT 1000  | Bucket capacity     |
| refill_rate           | DECIMAL(10,4) | NOT NULL DEFAULT 2.0   | Tokens/second       |
| last_refill_at        | TIMESTAMPTZ   | NOT NULL DEFAULT now() | Last refill time    |
| locked_until          | TIMESTAMPTZ   |                        | Backoff lock        |
| consecutive_429_count | INTEGER       | DEFAULT 0              | Throttle counter    |
| updated_at            | TIMESTAMPTZ   | DEFAULT now()          |                     |

**RLS Policy:** `rate_limit_buckets_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `api_cost_tracking`

> **Purpose:** GraphQL cost tracking per request (F4.3) - Partitioned by month

| Column           | Type             | Constraints            | Description                |
| ---------------- | ---------------- | ---------------------- | -------------------------- |
| id               | UUID             | PK DEFAULT uuidv7()    |                            |
| shop_id          | UUID             | FK shops(id) NOT NULL  |                            |
| operation_type   | VARCHAR(50)      | NOT NULL               | Query type                 |
| query_hash       | VARCHAR(64)      |                        | Query fingerprint          |
| actual_cost      | INTEGER          | NOT NULL               | Points used                |
| throttle_status  | VARCHAR(20)      |                        | THROTTLED if hit limit     |
| available_cost   | INTEGER          |                        | Remaining points           |
| restore_rate     | DECIMAL(10,2)    |                        | Points/second restore      |
| requested_at     | TIMESTAMPTZ      | DEFAULT now()          | Request timestamp          |
| response_time_ms | INTEGER          |                        | Latency                    |
| created_at       | TIMESTAMPTZ      | NOT NULL DEFAULT now() |                            |
| PRIMARY KEY      | (id, created_at) |                        | Composite for partitioning |

**Partitioning:** `PARTITION BY RANGE (created_at)` - Monthly partitions, 7-day retention

**Indexes:**

- `idx_api_cost_shop_date` ON (shop_id, requested_at DESC)
- `idx_api_cost_throttled` ON (shop_id, throttle_status) WHERE throttle_status IS NOT NULL

---

## Module H: Audit & Observability

### Table: `audit_logs`

| Column      | Type         | Constraints         | Description                         |
| ----------- | ------------ | ------------------- | ----------------------------------- |
| id          | UUID         | PK DEFAULT uuidv7() |                                     |
| shop_id     | UUID         | FK shops(id)        | Tenant context                      |
| user_id     | UUID         | FK staff_users(id)  | Who made the change                 |
| action      | VARCHAR(20)  | NOT NULL            | INSERT/UPDATE/DELETE                |
| entity_type | VARCHAR(100) | NOT NULL            | Table name (TG_TABLE_NAME)          |
| entity_id   | UUID         | NOT NULL            | Record ID (row id)                  |
| old_values  | JSONB        |                     | Previous state (NULL for INSERT)    |
| new_values  | JSONB        |                     | New state (NULL for DELETE)         |
| ip_address  | INET         |                     |                                     |
| user_agent  | TEXT         |                     |                                     |
| request_id  | VARCHAR(100) |                     | Trace correlation (app.trace_id)    |
| created_at  | TIMESTAMPTZ  | DEFAULT now()       |                                     |

**Indexes:**

- `idx_audit_shop` ON (shop_id, created_at DESC)
- `idx_audit_entity` ON (entity_type, entity_id)
- `idx_audit_user` ON (user_id)
- `idx_audit_request` ON (request_id)

**Partitioning:** PARTITION BY RANGE (created_at) - monthly

---

### Table: `sync_checkpoints`

| Column         | Type         | Constraints           | Description               |
| -------------- | ------------ | --------------------- | ------------------------- |
| id             | UUID         | PK DEFAULT uuidv7()   |                           |
| shop_id        | UUID         | FK shops(id) NOT NULL |                           |
| resource_type  | VARCHAR(50)  | NOT NULL              | products/orders/customers |
| last_sync_at   | TIMESTAMPTZ  | NOT NULL              |                           |
| last_cursor    | VARCHAR(255) |                       | Pagination cursor         |
| records_synced | INTEGER      | DEFAULT 0             |                           |
| status         | VARCHAR(20)  | DEFAULT 'idle'        | idle/running/error        |
| error_message  | TEXT         |                       |                           |
| metadata       | JSONB        | DEFAULT '{}'          |                           |
| created_at     | TIMESTAMPTZ  | DEFAULT now()         |                           |
| updated_at     | TIMESTAMPTZ  | DEFAULT now()         |                           |

**Indexes:**

- `idx_checkpoints_shop_resource` UNIQUE ON (shop_id, resource_type)

---

## Module I: Inventory Ledger (High-Velocity Tracking)

> **Pattern:** Append-only ledger cu materialized view pentru performanță. Suportă high-velocity inventory updates fără lock contention.

### Table: `inventory_ledger`

| Column            | Type          | Constraints                      | Description                                    |
| ----------------- | ------------- | -------------------------------- | ---------------------------------------------- |
| id                | UUID          | PK DEFAULT uuidv7()              | Entry ID                                       |
| shop_id           | UUID          | FK shops(id) NOT NULL            |                                                |
| variant_id        | UUID          | FK shopify_variants(id) NOT NULL |                                                |
| sku               | VARCHAR(255)  |                                  | Denormalized for queries                       |
| location_id       | VARCHAR(100)  |                                  | Shopify location GID                           |
| delta             | INTEGER       | NOT NULL                         | +/- quantity change                            |
| reason            | VARCHAR(50)   | NOT NULL                         | SALE/RESTOCK/ADJUSTMENT/RETURN/SYNC/TRANSFER   |
| reference_type    | VARCHAR(50)   |                                  | order/transfer/bulk_run                        |
| reference_id      | VARCHAR(255)  |                                  | Order ID, sync run ID, etc.                    |
| previous_quantity | INTEGER       |                                  | Quantity before change                         |
| new_quantity      | INTEGER       |                                  | Quantity after change                          |
| cost_per_unit     | DECIMAL(12,2) |                                  | Unit cost at time of change                    |
| recorded_at       | TIMESTAMPTZ   | NOT NULL DEFAULT now()           | Business timestamp                             |
| created_at        | TIMESTAMPTZ   | DEFAULT now()                    | System timestamp                               |

**Indexes:**

- `idx_ledger_variant` ON (variant_id, recorded_at DESC)
- `idx_ledger_shop_sku` ON (shop_id, sku, recorded_at DESC)
- `idx_ledger_location` ON (location_id, recorded_at DESC)
- `idx_ledger_reference` ON (reference_type, reference_id)
- `idx_ledger_reason` ON (shop_id, reason, recorded_at DESC)

**RLS Policy:** `ledger_policy` - shop_id = current_setting('app.current_shop_id')::uuid

**Partitioning:** PARTITION BY RANGE (recorded_at) - monthly

---

### Materialized View: `inventory_current`

```sql
CREATE MATERIALIZED VIEW inventory_current AS
SELECT 
  variant_id,
  location_id,
  SUM(delta) as quantity,
  MAX(recorded_at) as last_updated_at
FROM inventory_ledger
GROUP BY variant_id, location_id;

CREATE UNIQUE INDEX idx_inventory_current_pk ON inventory_current(variant_id, location_id);
CREATE INDEX idx_inventory_current_quantity ON inventory_current(quantity);

-- Refresh strategy: CONCURRENTLY after bulk operations
-- REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_current;
```

---

### Table: `inventory_locations`

| Column                 | Type         | Constraints           | Description         |
| ---------------------- | ------------ | --------------------- | ------------------- |
| id                     | UUID         | PK DEFAULT uuidv7()   |                     |
| shop_id                | UUID         | FK shops(id) NOT NULL |                     |
| shopify_gid            | VARCHAR(100) | NOT NULL              |                     |
| legacy_resource_id     | BIGINT       |                       |                     |
| name                   | VARCHAR(255) | NOT NULL              | Location name       |
| address                | JSONB        |                       | Full address object |
| is_active              | BOOLEAN      | DEFAULT true          |                     |
| is_primary             | BOOLEAN      | DEFAULT false         | Default fulfillment |
| fulfills_online_orders | BOOLEAN      | DEFAULT true          |                     |
| synced_at              | TIMESTAMPTZ  | DEFAULT now()         |                     |
| created_at             | TIMESTAMPTZ  | DEFAULT now()         |                     |
| updated_at             | TIMESTAMPTZ  | DEFAULT now()         |                     |

**Indexes:**

- `idx_locations_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_locations_shop_active` ON (shop_id, is_active)

**RLS Policy:** `locations_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

## Module J: Shopify Media & Publications

> **Derivat din:** Shopify Admin GraphQL API 2025-01 - câmpuri `media`, `featuredMedia`, `resourcePublications`, `variants.media`

### Table: `shopify_media`

| Column             | Type        | Constraints           | Description                         |
| ------------------ | ----------- | --------------------- | ----------------------------------- |
| media_id           | UUID        | PK DEFAULT uuidv7()   | local media id                      |
| shop_id            | UUID        | FK shops(id) NOT NULL | shopify media id                    |
| shopify_gid        | VARCHAR(100)| NOT NULL              | gid://shopify/MediaImage/123        |
| legacy_resource_id | BIGINT      |                       |                                     |
| media_type         | VARCHAR(30) | NOT NULL              | IMAGE/VIDEO/MODEL_3D/EXTERNAL_VIDEO |
| alt                | TEXT        |                       | Alt text                            |
| status             | VARCHAR(20) | NOT NULL              | UPLOADED/PROCESSING/READY/FAILED    |
| mime_type          | VARCHAR(100)|                       | image/jpeg, video/mp4               |
| file_size          | BIGINT      |                       | Bytes                               |
| width              | INTEGER     |                       | Pixels                              |
| height             | INTEGER     |                       | Pixels                              |
| duration           | INTEGER     |                       | Video duration ms                   |
| url                | TEXT        |                       | CDN URL                             |
| preview_url        | TEXT        |                       | Preview/thumbnail URL               |
| sources            | JSONB       | DEFAULT '[]'          | [{url, mimeType, format}]           |
| metadata           | JSONB       | DEFAULT '{}'          | Type-specific metadata              |
| created_at_shopify | TIMESTAMPTZ |                       |                                     |
| synced_at          | TIMESTAMPTZ | DEFAULT now()         |                                     |
| created_at         | TIMESTAMPTZ | DEFAULT now()         |                                     |
| updated_at         | TIMESTAMPTZ | DEFAULT now()         |                                     |

**Indexes:**

- `idx_media_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_media_type` ON (shop_id, media_type)
- `idx_media_status` ON (shop_id, status)

**RLS Policy:** `media_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_product_media`

| Column      | Type        | Constraints                      | Description                   |
| ----------- | ----------- | -------------------------------- | ----------------------------- |
| shop_id     | UUID        | FK shops(id) NOT NULL            | Tenant (denormalized for RLS) |
| product_id  | UUID        | FK shopify_products(id) NOT NULL |                               |
| media_id    | UUID        | FK shopify_media(id) NOT NULL    |                               |
| position    | INTEGER     | DEFAULT 0                        | Sort order                    |
| is_featured | BOOLEAN     | DEFAULT false                    | Featured media                |
| created_at  | TIMESTAMPTZ | DEFAULT now()                    |                               |
| updated_at  | TIMESTAMPTZ | DEFAULT now()                    |                               |

**Primary Key:** (product_id, media_id)

**Indexes:**

- `idx_product_media_shop` ON (shop_id)
- `idx_product_media_product` ON (product_id, position)
- `idx_product_media_featured` ON (product_id) WHERE is_featured = true

**RLS Policy:** `product_media_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_variant_media`

| Column     | Type         | Constraints                      | Description                   |
| ---------- | ------------ | -------------------------------- | ----------------------------- |
| shop_id    | UUID         | FK shops(id) NOT NULL            | Tenant (denormalized for RLS) |
| variant_id | UUID         | FK shopify_variants(id) NOT NULL |                               |
| media_id   | UUID         | FK shopify_media(id) NOT NULL    |                               |
| position   | INTEGER      | DEFAULT 0                        | Sort order                    |
| created_at | TIMESTAMPTZ  | DEFAULT now()                    |                               |
| updated_at | TIMESTAMPTZ  | DEFAULT now()                    |                               |

**Primary Key:** (variant_id, media_id)

**Indexes:**

- `idx_variant_media_shop` ON (shop_id)

**RLS Policy:** `variant_media_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_publications`

| Column                     | Type         | Constraints                   | Description                 |
| -------------------------- | ------------ | ----------------------------- | --------------------------- |
| id                         | UUID         | PK DEFAULT uuidv7()           |                             |
| shop_id                    | UUID         | FK shops(id) NOT NULL         |                             |
| shopify_gid                | VARCHAR(100) | NOT NULL                      |                             |
| name                       | VARCHAR(255) | NOT NULL                      | Channel name                |
| catalog_type               | VARCHAR(50)  |                               | APP/MARKET/COMPANY_LOCATION |
| supports_future_publishing | BOOLEAN      | DEFAULT false                 |                             |
| auto_publish               | BOOLEAN      | DEFAULT false                 |                             |
| is_active                  | BOOLEAN      | DEFAULT true                  |                             |
| synced_at                  | TIMESTAMPTZ  | DEFAULT now()                 |                             |
| created_at                 | TIMESTAMPTZ  | DEFAULT now()                 |                             |
| updated_at                 | TIMESTAMPTZ  | DEFAULT now()                 |                             |

**Indexes:**

- `idx_publications_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_publications_shop_active` ON (shop_id, is_active)

**RLS Policy:** `publications_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_resource_publications`

| Column         | Type        | Constraints                          | Description                                   |
| -------------- | ----------- | ------------------------------------ | --------------------------------------------- |
| id             | UUID        | PK DEFAULT uuidv7()                  |                                               |
| shop_id        | UUID        | FK shops(id) NOT NULL                |                                               |
| publication_id | UUID        | FK shopify_publications(id) NOT NULL |                                               |
| resource_type  | VARCHAR(50) | NOT NULL                             | Product/Collection                            |
| resource_id    | UUID        | NOT NULL                             | shopify_products.id or shopify_collections.id |
| is_published   | BOOLEAN     | NOT NULL DEFAULT false               |                                               |
| published_at   | TIMESTAMPTZ |                                      | When actually published                       |
| publish_date   | TIMESTAMPTZ |                                      | Scheduled future publish date                 |
| created_at     | TIMESTAMPTZ | DEFAULT now()                        |                                               |
| updated_at     | TIMESTAMPTZ | DEFAULT now()                        |                                               |

**Indexes:**

- `idx_resource_pub_publication` ON (publication_id)
- `idx_resource_pub_resource` UNIQUE ON (shop_id, publication_id, resource_type, resource_id)
- `idx_resource_pub_published` ON (shop_id, resource_type, is_published)

---

## Module K: Menus & Navigation

> **Derivat din:** Research Categorii - structuri arboresente din CatOutputs/menu_tree.json

### Table: `shopify_menus`

| Column.     | Type         | Constraints           | Description.     |
| ----------- | ------------ | --------------------- | ---------------- |
| id          | UUID         | PK DEFAULT uuidv7()   | internal menu id |
| shop_id     | UUID         | FK shops(id) NOT NULL | shop id          |
| shopify_gid | VARCHAR(100) | NOT NULL              | shopify menu id  |
| title       | TEXT         | NOT NULL              | Menu name        |
| handle      | VARCHAR(255) | NOT NULL              | URL handle       |
| items_count | INTEGER      | DEFAULT 0             | no. of items     |
| synced_at   | TIMESTAMPTZ  | DEFAULT now()         |                  |
| created_at  | TIMESTAMPTZ  | DEFAULT now()         |                  |
| updated_at  | TIMESTAMPTZ  | DEFAULT now()         |                  |

**Indexes:**

- `idx_menus_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_menus_shop_handle` ON (shop_id, handle)

**RLS Policy:** `menus_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `shopify_menu_items`

| Column         | Type         | Constraints                   | Description                                         |
| -------------- | ------------ | ----------------------------- | --------------------------------------------------- |
| id             | UUID         | PK DEFAULT uuidv7()           |                                                     |
| shop_id        | UUID         | FK shops(id) NOT NULL         |                                                     |
| menu_id        | UUID         | FK shopify_menus(id) NOT NULL |                                                     |
| shopify_gid    | VARCHAR(100) | NOT NULL                      |                                                     |
| parent_item_id | UUID         | FK shopify_menu_items(id)     | Self-reference for tree                             |
| title          | TEXT         | NOT NULL                      | Display text                                        |
| url            | TEXT         |                               | Link URL                                            |
| item_type      | VARCHAR(50)  |                               | FRONTPAGE/COLLECTION/PAGE/PRODUCT/BLOG/ARTICLE/HTTP |
| resource_id    | VARCHAR(100) |                               | Referenced resource GID                             |
| position       | INTEGER      | DEFAULT 0                     | Sort order                                          |
| level          | INTEGER      | DEFAULT 0                     | Depth in tree                                       |
| path           | TEXT[]       |                               | Materialized path for breadcrumbs                   |
| created_at     | TIMESTAMPTZ  | DEFAULT now()                 |                                                     |
| updated_at     | TIMESTAMPTZ  | DEFAULT now()                 |                                                     |

**Indexes:**

- `idx_menu_items_shop_gid` UNIQUE ON (shop_id, shopify_gid)
- `idx_menu_items_menu` ON (menu_id, position)
- `idx_menu_items_parent` ON (parent_item_id)
- `idx_menu_items_type` ON (shop_id, item_type)
- `idx_menu_items_path` GIN ON (path)

**RLS Policy:** `menu_items_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

## Module L: Scraper & Crawler Management

> **Pentru workers și scrapers:** Tracking și scheduling pentru web scraping

### Table: `scraper_configs`

| Column             | Type         | Constraints                  | Description                   |
| ------------------ | ------------ | ---------------------------- | ----------------------------- |
| id                 | UUID         | PK DEFAULT uuidv7()          |                               |
| source_id          | UUID         | FK prod_sources(id) NOT NULL |                               |
| name               | VARCHAR(100) | NOT NULL                     | Config name                   |
| scraper_type       | VARCHAR(50)  | NOT NULL                     | CHEERIO/PLAYWRIGHT/PUPPETEER  |
| target_url_pattern | TEXT         | NOT NULL                     | URL regex pattern             |
| selectors          | JSONB        | NOT NULL                     | CSS/XPath selectors           |
| pagination_config  | JSONB        |                              | {type, selector, maxPages}    |
| rate_limit         | JSONB        |                              | {requestsPerSecond, minDelay} |
| retry_config       | JSONB        |                              | {maxRetries, backoffMs}       |
| headers            | JSONB        | DEFAULT '{}'                 | Custom headers                |
| cookies            | JSONB        | DEFAULT '{}'                 |                               |
| proxy_config       | JSONB        |                              | Proxy settings                |
| is_active          | BOOLEAN      | DEFAULT true                 |                               |
| last_run_at        | TIMESTAMPTZ  |                              |                               |
| success_rate       | DECIMAL(5,2) |                              | % successful                  |
| created_at         | TIMESTAMPTZ  | DEFAULT now()                |                               |
| updated_at         | TIMESTAMPTZ  | DEFAULT now()                |                               |

**Indexes:**

- `idx_scraper_configs_source` ON (source_id)
- `idx_scraper_configs_active` ON (is_active, scraper_type)

---

### Table: `scraper_runs`

| Column           | Type        | Constraints                     | Description                                |
| ---------------- | ----------- | ------------------------------- | ------------------------------------------ |
| id               | UUID        | PK DEFAULT uuidv7()             |                                            |
| config_id        | UUID        | FK scraper_configs(id) NOT NULL |                                            |
| source_id        | UUID        | FK prod_sources(id) NOT NULL    |                                            |
| status           | VARCHAR(20) | NOT NULL DEFAULT 'pending'      | pending/running/completed/failed/cancelled |
| trigger_type     | VARCHAR(30) |                                 | manual/scheduled/webhook                   |
| target_urls      | TEXT[]      |                                 | Specific URLs to scrape                    |
| pages_crawled    | INTEGER     | DEFAULT 0                       |                                            |
| products_found   | INTEGER     | DEFAULT 0                       |                                            |
| products_updated | INTEGER     | DEFAULT 0                       |                                            |
| errors_count     | INTEGER     | DEFAULT 0                       |                                            |
| error_log        | JSONB       | DEFAULT '[]'                    | [{url, error, timestamp}]                  |
| started_at       | TIMESTAMPTZ |                                 |                                            |
| completed_at     | TIMESTAMPTZ |                                 |                                            |
| duration_ms      | INTEGER     |                                 | Total runtime                              |
| memory_peak_mb   | INTEGER     |                                 | Peak memory usage                          |
| created_at       | TIMESTAMPTZ | DEFAULT now()                   |                                            |

**Indexes:**

- `idx_scraper_runs_config` ON (config_id, created_at DESC)
- `idx_scraper_runs_status` ON (status, created_at DESC)
- `idx_scraper_runs_source` ON (source_id, created_at DESC)

---

### Table: `scraper_queue`

| Column          | Type         | Constraints                     | Description                         |
| --------------- | ------------ | ------------------------------- | ----------------------------------- |
| id              | UUID         | PK DEFAULT uuidv7()             |                                     |
| config_id       | UUID         | FK scraper_configs(id) NOT NULL |                                     |
| url             | TEXT         | NOT NULL                        | URL to scrape                       |
| priority        | INTEGER      | DEFAULT 0                       | Higher = first                      |
| depth           | INTEGER      | DEFAULT 0                       | Crawl depth from seed               |
| parent_url      | TEXT         |                                 | Referring URL                       |
| status          | VARCHAR(20)  | DEFAULT 'pending'               | pending/processing/completed/failed |
| attempts        | INTEGER      | DEFAULT 0                       |                                     |
| max_attempts    | INTEGER      | DEFAULT 3                       |                                     |
| last_attempt_at | TIMESTAMPTZ  |                                 |                                     |
| next_attempt_at | TIMESTAMPTZ  |                                 | Backoff time                        |
| error_message   | TEXT         |                                 |                                     |
| created_at      | TIMESTAMPTZ  | DEFAULT now()                   |                                     |

**Indexes:**

- `idx_scraper_queue_pending` ON (config_id, priority DESC, created_at) WHERE status = 'pending'
- `idx_scraper_queue_url` ON (url)
- `idx_scraper_queue_next` ON (next_attempt_at) WHERE status = 'pending'

---

### Table: `api_usage_log`

> **Purpose:** Track external API usage and costs for budget management (Gap #3 - F8.4.7)

| Column          | Type           | Constraints                 | Description                       |
| --------------- | -------------- | --------------------------- | --------------------------------- |
| id              | UUID           | PK DEFAULT uuidv7()         |                                   |
| api_provider    | VARCHAR(50)    | NOT NULL                    | google/xai/emag/barcodelookup     |
| endpoint        | VARCHAR(100)   | NOT NULL                    | API endpoint path                 |
| request_count   | INTEGER        | NOT NULL DEFAULT 1          | Requests in this batch            |
| tokens_input    | INTEGER        |                             | Input tokens (LLM only)           |
| tokens_output   | INTEGER        |                             | Output tokens (LLM only)          |
| estimated_cost  | DECIMAL(10,4)  |                             | Cost in USD                       |
| http_status     | INTEGER        |                             | Response status code              |
| response_time_ms| INTEGER        |                             | Request latency                   |
| job_id          | VARCHAR(255)   |                             | BullMQ job reference              |
| product_id      | UUID           | FK prod_master(id)          | If related to specific product    |
| shop_id         | UUID           | FK shops(id)                | If shop-specific                  |
| error_message   | TEXT           |                             | Error if request failed           |
| metadata        | JSONB          | DEFAULT '{}'                | Additional request context        |
| created_at      | TIMESTAMPTZ    | DEFAULT now()               |                                   |

**Indexes:**

- `idx_api_usage_provider_date` ON (api_provider, created_at)
- `idx_api_usage_product` ON (product_id) WHERE product_id IS NOT NULL
- `idx_api_usage_shop` ON (shop_id, created_at) WHERE shop_id IS NOT NULL
- `idx_api_usage_cost` ON (created_at, estimated_cost) WHERE estimated_cost > 0
- `idx_api_usage_errors` ON (api_provider, created_at) WHERE http_status >= 400

**RLS Policy:** Optional - shop_id = current_setting('app.current_shop_id')::uuid (if shop_id IS NOT NULL)

**Partitioning:** PARTITION BY RANGE (created_at) - monthly partitions

---

### View: `v_api_daily_costs`

> **Purpose:** Aggregated daily costs per API provider

```sql
CREATE VIEW v_api_daily_costs AS
SELECT 
  DATE(created_at) as date,
  api_provider,
  SUM(request_count) as total_requests,
  SUM(tokens_input) as total_input_tokens,
  SUM(tokens_output) as total_output_tokens,
  SUM(estimated_cost) as total_cost,
  COUNT(*) FILTER (WHERE http_status >= 400) as error_count,
  AVG(response_time_ms) as avg_response_time_ms
FROM api_usage_log
GROUP BY DATE(created_at), api_provider;
```

---

## Module M: Analytics & Reporting

> **Frontend dashboards:** Precomputed metrics și aggregations

### Table: `analytics_daily_shop`

| Column               | Type          | Constraints           | Description |
| -------------------- | ------------- | --------------------- | ----------- |
| id                   | UUID          | PK DEFAULT uuidv7()   |             |
| shop_id              | UUID          | FK shops(id) NOT NULL |             |
| date                 | DATE          | NOT NULL              |             |
| orders_count         | INTEGER       | DEFAULT 0             |             |
| orders_total         | DECIMAL(14,2) | DEFAULT 0             |             |
| orders_avg           | DECIMAL(12,2) | DEFAULT 0             |             |
| products_synced      | INTEGER       | DEFAULT 0             |             |
| variants_synced      | INTEGER       | DEFAULT 0             |             |
| customers_new        | INTEGER       | DEFAULT 0             |             |
| inventory_value      | DECIMAL(14,2) | DEFAULT 0             |             |
| low_stock_count      | INTEGER       | DEFAULT 0             |             |
| out_of_stock_count   | INTEGER       | DEFAULT 0             |             |
| bulk_runs_count      | INTEGER       | DEFAULT 0             |             |
| bulk_runs_failed     | INTEGER       | DEFAULT 0             |             |
| api_calls_count      | INTEGER       | DEFAULT 0             |             |
| webhook_events_count | INTEGER       | DEFAULT 0             |             |
| created_at           | TIMESTAMPTZ   | DEFAULT now()         |             |

**Indexes:**

- `idx_analytics_daily_shop_date` UNIQUE ON (shop_id, date)
- `idx_analytics_daily_date` ON (date DESC)

**RLS Policy:** `analytics_daily_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Table: `analytics_product_performance`

| Column             | Type          | Constraints                      | Description.         |
| ------------------ | ------------- | -------------------------------- | -------------------- |
| id                 | UUID          | PK DEFAULT uuidv7()              |                      |
| shop_id            | UUID          | FK shops(id) NOT NULL            |                      |
| product_id         | UUID          | FK shopify_products(id) NOT NULL |                      |
| period_start       | DATE          | NOT NULL                         |                      |
| period_end         | DATE          | NOT NULL                         |                      |
| period_type        | VARCHAR(20)   | NOT NULL                         | daily/weekly/monthly |
| views_count        | INTEGER       | DEFAULT 0                        | If tracked           |
| orders_count       | INTEGER       | DEFAULT 0                        |                      |
| units_sold         | INTEGER       | DEFAULT 0                        |                      |
| revenue            | DECIMAL(12,2) | DEFAULT 0                        |                      |
| avg_order_value    | DECIMAL(12,2) | DEFAULT 0                        |                      |
| return_rate        | DECIMAL(5,2)  | DEFAULT 0                        | % returned           |
| inventory_turnover | DECIMAL(8,4)  |                                  |                      |
| created_at         | TIMESTAMPTZ   | DEFAULT now()                    |                      |

**Indexes:**

- `idx_product_perf_product` ON (product_id, period_type, period_start DESC)
- `idx_product_perf_shop_period` ON (shop_id, period_type, period_start DESC)
- `idx_product_perf_revenue` ON (shop_id, period_type, revenue DESC)

**RLS Policy:** `product_perf_policy` - shop_id = current_setting('app.current_shop_id')::uuid

---

### Materialized View: `mv_shop_summary`

> **Purpose:** Dashboard summary metrics per shop - refreshed hourly

```sql
CREATE MATERIALIZED VIEW mv_shop_summary AS
SELECT 
  s.id as shop_id,
  s.shopify_domain,
  COUNT(DISTINCT sp.id) as total_products,
  COUNT(DISTINCT sv.id) as total_variants,
  COUNT(DISTINCT sc.id) as total_collections,
  COUNT(DISTINCT so.id) as total_orders,
  COALESCE(SUM(so.total_price), 0) as total_revenue,
  COUNT(DISTINCT cust.id) as total_customers,
  MAX(sp.synced_at) as last_product_sync,
  MAX(so.synced_at) as last_order_sync
FROM shops s
LEFT JOIN shopify_products sp ON sp.shop_id = s.id AND sp.status = 'ACTIVE'
LEFT JOIN shopify_variants sv ON sv.shop_id = s.id
LEFT JOIN shopify_collections sc ON sc.shop_id = s.id
LEFT JOIN shopify_orders so ON so.shop_id = s.id
LEFT JOIN shopify_customers cust ON cust.shop_id = s.id
GROUP BY s.id, s.shopify_domain;

CREATE UNIQUE INDEX idx_mv_shop_summary_pk ON mv_shop_summary(shop_id);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_summary;
```

---

### Materialized View: `mv_low_stock_alerts`

> **Purpose:** Products with low inventory - refreshed every 15 minutes

```sql
CREATE MATERIALIZED VIEW mv_low_stock_alerts AS
SELECT
  v.shop_id,
  v.id as variant_id,
  v.product_id,
  v.sku,
  v.title as variant_title,
  p.title as product_title,
  v.inventory_quantity,
  COALESCE((p.metafields->>'low_stock_threshold')::int, 5) as threshold
FROM shopify_variants v
JOIN shopify_products p ON p.id = v.product_id
WHERE v.inventory_quantity <= COALESCE((p.metafields->>'low_stock_threshold')::int, 5)
  AND v.inventory_quantity >= 0
  AND p.status = 'ACTIVE';

CREATE INDEX idx_mv_low_stock_shop ON mv_low_stock_alerts(shop_id);
CREATE INDEX idx_mv_low_stock_qty ON mv_low_stock_alerts(inventory_quantity);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_low_stock_alerts;
```

---

### Materialized View: `mv_top_sellers`

> **Purpose:** Top selling products per shop (last 30 days) - refreshed daily

```sql
CREATE MATERIALIZED VIEW mv_top_sellers AS
WITH order_items AS (
  SELECT
    o.shop_id,
    (item->>'variant_id')::uuid as variant_id,
    (item->>'quantity')::int as quantity,
    (item->>'price')::decimal as price
  FROM shopify_orders o,
       jsonb_array_elements(o.line_items) as item
  WHERE o.created_at_shopify >= NOW() - INTERVAL '30 days'
    AND o.financial_status IN ('PAID', 'PARTIALLY_REFUNDED')
)
SELECT
  oi.shop_id,
  v.product_id,
  p.title as product_title,
  SUM(oi.quantity) as units_sold,
  SUM(oi.quantity * oi.price) as revenue,
  COUNT(DISTINCT oi.variant_id) as variants_sold,
  RANK() OVER (PARTITION BY oi.shop_id ORDER BY SUM(oi.quantity * oi.price) DESC) as revenue_rank
FROM order_items oi
JOIN shopify_variants v ON v.id = oi.variant_id
JOIN shopify_products p ON p.id = v.product_id
GROUP BY oi.shop_id, v.product_id, p.title;

CREATE INDEX idx_mv_top_sellers_shop ON mv_top_sellers(shop_id);
CREATE INDEX idx_mv_top_sellers_rank ON mv_top_sellers(shop_id, revenue_rank);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_sellers;
```

---

### Materialized View: `mv_pim_quality_progress`

> **Purpose:** PIM quality level distribution and progress metrics - refreshed hourly (Gap #4)

```sql
CREATE MATERIALIZED VIEW mv_pim_quality_progress AS
SELECT
  data_quality_level,
  COUNT(*) as product_count,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) as percentage,
  AVG(quality_score) as avg_quality_score,
  COUNT(*) FILTER (WHERE needs_review = true) as needs_review_count,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '24 hours') as promoted_to_silver_24h,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '24 hours') as promoted_to_golden_24h,
  COUNT(*) FILTER (WHERE promoted_to_silver_at >= NOW() - INTERVAL '7 days') as promoted_to_silver_7d,
  COUNT(*) FILTER (WHERE promoted_to_golden_at >= NOW() - INTERVAL '7 days') as promoted_to_golden_7d,
  MAX(updated_at) as last_update
FROM prod_master
GROUP BY data_quality_level;

CREATE UNIQUE INDEX idx_mv_pim_quality_level ON mv_pim_quality_progress(data_quality_level);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_quality_progress;
```

---

### Materialized View: `mv_pim_enrichment_status`

> **Purpose:** Track enrichment progress from external sources - refreshed hourly

```sql
CREATE MATERIALIZED VIEW mv_pim_enrichment_status AS
SELECT
  pm.data_quality_level,
  COUNT(DISTINCT pm.id) as total_products,
  COUNT(DISTINCT psm.product_id) as products_with_matches,
  COUNT(psm.id) as total_matches,
  COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'confirmed') as confirmed_matches,
  COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'pending') as pending_matches,
  COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'rejected') as rejected_matches,
  COUNT(DISTINCT psm.source_id) as unique_sources,
  AVG(psm.similarity_score) FILTER (WHERE psm.match_confidence = 'confirmed') as avg_confirmed_similarity,
  COUNT(DISTINCT pes.product_id) as products_with_specs,
  MAX(psm.created_at) as last_match_found
FROM prod_master pm
LEFT JOIN prod_similarity_matches psm ON psm.product_id = pm.id
LEFT JOIN prod_specs_normalized pes ON pes.product_id = pm.id AND pes.is_current = true
GROUP BY pm.data_quality_level;

CREATE UNIQUE INDEX idx_mv_pim_enrichment_level ON mv_pim_enrichment_status(data_quality_level);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_enrichment_status;
```

---

### Materialized View: `mv_pim_source_performance`

> **Purpose:** Track which external sources provide best quality matches - refreshed daily

```sql
CREATE MATERIALIZED VIEW mv_pim_source_performance AS
SELECT
  ps.id as source_id,
  ps.name as source_name,
  ps.source_type,
  ps.trust_score,
  COUNT(psm.id) as total_matches,
  COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'confirmed') as confirmed_matches,
  COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'rejected') as rejected_matches,
  ROUND(
    COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'confirmed')::numeric / 
    NULLIF(COUNT(psm.id) FILTER (WHERE psm.match_confidence IN ('confirmed', 'rejected')), 0) * 100, 
    2
  ) as confirmation_rate,
  AVG(psm.similarity_score) as avg_similarity,
  COUNT(DISTINCT psm.product_id) as products_enriched,
  COUNT(DISTINCT pes.id) as specs_extracted,
  MAX(psm.scraped_at) as last_scrape
FROM prod_sources ps
LEFT JOIN prod_similarity_matches psm ON psm.source_id = ps.id
LEFT JOIN prod_extraction_sessions pes ON pes.id = psm.extraction_session_id
GROUP BY ps.id, ps.name, ps.source_type, ps.trust_score;

CREATE UNIQUE INDEX idx_mv_pim_source_perf_pk ON mv_pim_source_performance(source_id);
CREATE INDEX idx_mv_pim_source_perf_rate ON mv_pim_source_performance(confirmation_rate DESC);

-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pim_source_performance;
```

---

## Extensions Required

```sql
-- Core extensions (required)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- Encryption functions
CREATE EXTENSION IF NOT EXISTS "citext";        -- Case-insensitive text
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- Trigram similarity for fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gin";     -- GIN index for scalars
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- GiST index for exclusion constraints
CREATE EXTENSION IF NOT EXISTS "vector";        -- pgvector for embeddings

-- Optional but recommended
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";  -- Query performance monitoring
CREATE EXTENSION IF NOT EXISTS "pgstattuple";         -- Tuple-level statistics
```

---

## Shopify GraphQL ↔ PostgreSQL Data Type Mapping

> **Reference:** Shopify Admin GraphQL API 2025-01

| Shopify GraphQL Type   | PostgreSQL Type        | Notes                                 |
| ---------------------- | ---------------------- | ------------------------------------- |
| `ID!`                  | `TEXT`                 | GID format: gid://shopify/Product/123 |
| `UnsignedInt64`        | `BIGINT`               | Legacy numeric IDs                    |
| `String` / `String!`   | `TEXT` or `VARCHAR(n)` | Use TEXT for unbounded                |
| `HTML`                 | `TEXT`                 | Store raw HTML                        |
| `URL`                  | `TEXT`                 | Full URL strings                      |
| `DateTime`             | `TIMESTAMPTZ`          | Always timezone-aware                 |
| `Date`                 | `DATE`                 | Date only                             |
| `Boolean`              | `BOOLEAN`              |                                       |
| `Int`                  | `INTEGER`              |                                       |
| `Float`                | `DECIMAL(12,4)`        | Use DECIMAL for precision             |
| `Money`                | `DECIMAL(12,2)`        | Currency amounts                      |
| `Decimal`              | `DECIMAL(12,4)`        | High precision decimals               |
| `[String!]!` (tags)    | `TEXT[]`               | Array with GIN index                  |
| `ENUM` (ProductStatus) | `VARCHAR(20) CHECK`    | Use CHECK constraint                  |
| `JSON` / Object        | `JSONB`                | Use JSONB, not JSON                   |
| `Connection` (edges)   | Normalized table       | M:N relationship tables               |

### ENUM Value Mappings

```sql
-- ProductStatus
CHECK (status IN ('ACTIVE', 'DRAFT', 'ARCHIVED'))

-- FulfillmentStatus  
CHECK (fulfillment_status IN ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'SCHEDULED', 'ON_HOLD'))

-- FinancialStatus
CHECK (financial_status IN ('PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'))

-- InventoryPolicy
CHECK (inventory_policy IN ('DENY', 'CONTINUE'))

-- WeightUnit
CHECK (weight_unit IN ('KILOGRAMS', 'GRAMS', 'POUNDS', 'OUNCES'))

-- MediaContentType
CHECK (media_type IN ('IMAGE', 'VIDEO', 'MODEL_3D', 'EXTERNAL_VIDEO'))
```

---

## RLS Policies - Complete Reference

> **Pattern:** All multi-tenant tables use `shop_id` for isolation via `app.current_shop_id` session variable.

### Module A: System Core

```sql
-- staff_users
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_users_tenant_isolation ON staff_users
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE staff_users FORCE ROW LEVEL SECURITY;

-- app_sessions
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_sessions_tenant_isolation ON app_sessions
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE app_sessions FORCE ROW LEVEL SECURITY;
```

### Module B: Shopify Mirror RLS

```sql
-- shopify_products
ALTER TABLE shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_tenant_isolation ON shopify_products
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_products FORCE ROW LEVEL SECURITY;

-- shopify_variants
ALTER TABLE shopify_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY variants_tenant_isolation ON shopify_variants
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_variants FORCE ROW LEVEL SECURITY;

-- shopify_collections
ALTER TABLE shopify_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collections_tenant_isolation ON shopify_collections
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_collections FORCE ROW LEVEL SECURITY;

-- shopify_orders
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_tenant_isolation ON shopify_orders
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_orders FORCE ROW LEVEL SECURITY;

-- shopify_customers
ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_tenant_isolation ON shopify_customers
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_customers FORCE ROW LEVEL SECURITY;

-- shopify_metaobjects
ALTER TABLE shopify_metaobjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY metaobjects_tenant_isolation ON shopify_metaobjects
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_metaobjects FORCE ROW LEVEL SECURITY;

-- shopify_webhooks
ALTER TABLE shopify_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant_isolation ON shopify_webhooks
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_webhooks FORCE ROW LEVEL SECURITY;
```

### Module C: Bulk Operations

```sql
-- bulk_runs
ALTER TABLE bulk_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_runs_tenant_isolation ON bulk_runs
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE bulk_runs FORCE ROW LEVEL SECURITY;

-- bulk_steps
ALTER TABLE bulk_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_steps_tenant_isolation ON bulk_steps
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE bulk_steps FORCE ROW LEVEL SECURITY;

-- bulk_artifacts
ALTER TABLE bulk_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_artifacts_tenant_isolation ON bulk_artifacts
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE bulk_artifacts FORCE ROW LEVEL SECURITY;

-- bulk_errors
ALTER TABLE bulk_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY bulk_errors_tenant_isolation ON bulk_errors
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE bulk_errors FORCE ROW LEVEL SECURITY;

-- staging_products
ALTER TABLE staging_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_products_tenant_isolation ON staging_products
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE staging_products FORCE ROW LEVEL SECURITY;

-- staging_variants
ALTER TABLE staging_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY staging_variants_tenant_isolation ON staging_variants
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE staging_variants FORCE ROW LEVEL SECURITY;
```

### Module D: Global PIM (NO RLS - Global Data)

```sql
-- PIM tables are GLOBAL, shared across all shops
-- NO RLS policies - intentional design decision
-- Access control via application layer for admin users only
```

### Module E: Attribute Normalization (per-shop embeddings only)

```sql
-- shop_product_embeddings (per-tenant vector search)
ALTER TABLE shop_product_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_embeddings_tenant_isolation ON shop_product_embeddings
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shop_product_embeddings FORCE ROW LEVEL SECURITY;

-- Note: prod_embeddings, prod_attr_definitions, prod_attr_synonyms are GLOBAL (no RLS)
-- Access controlled at application layer for admin users only
```

### Module F: AI Batch Processing RLS

```sql
-- ai_batches
ALTER TABLE ai_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_batches_tenant_isolation ON ai_batches
  USING (shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE ai_batches FORCE ROW LEVEL SECURITY;

-- ai_batch_items
ALTER TABLE ai_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_batch_items_tenant_isolation ON ai_batch_items
  USING (batch_id IN (
    SELECT id FROM ai_batches 
    WHERE shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid
  ));
ALTER TABLE ai_batch_items FORCE ROW LEVEL SECURITY;
```

### Module G: Queue & Jobs

```sql
-- job_runs
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_runs_tenant_isolation ON job_runs
  USING (shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;

-- scheduled_tasks
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY scheduled_tasks_tenant_isolation ON scheduled_tasks
  USING (shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE scheduled_tasks FORCE ROW LEVEL SECURITY;
```

### Module H: Audit

```sql
-- audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  USING (shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- sync_checkpoints
ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_checkpoints_tenant_isolation ON sync_checkpoints
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE sync_checkpoints FORCE ROW LEVEL SECURITY;
```

### Module I: Inventory Ledger

```sql
-- inventory_ledger
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_ledger_tenant_isolation ON inventory_ledger
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE inventory_ledger FORCE ROW LEVEL SECURITY;

-- inventory_locations
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_locations_tenant_isolation ON inventory_locations
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE inventory_locations FORCE ROW LEVEL SECURITY;

-- Note: inventory_current (MV) inherits RLS from inventory_ledger
```

### Module J: Media & Publications

```sql
-- shopify_media
ALTER TABLE shopify_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_tenant_isolation ON shopify_media
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_media FORCE ROW LEVEL SECURITY;

-- shopify_publications
ALTER TABLE shopify_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY publications_tenant_isolation ON shopify_publications
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_publications FORCE ROW LEVEL SECURITY;

-- shopify_resource_publications
ALTER TABLE shopify_resource_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_publications_tenant_isolation ON shopify_resource_publications
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_resource_publications FORCE ROW LEVEL SECURITY;

-- shopify_product_media (now has shop_id for direct RLS)
ALTER TABLE shopify_product_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_media_tenant_isolation ON shopify_product_media
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_product_media FORCE ROW LEVEL SECURITY;

-- shopify_variant_media (now has shop_id for direct RLS)
ALTER TABLE shopify_variant_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_media_tenant_isolation ON shopify_variant_media
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_variant_media FORCE ROW LEVEL SECURITY;

-- shopify_collection_products (now has shop_id for direct RLS)
ALTER TABLE shopify_collection_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_products_tenant_isolation ON shopify_collection_products
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_collection_products FORCE ROW LEVEL SECURITY;
```

### Module K: Menus & Navigation RLS

```sql
-- shopify_menus
ALTER TABLE shopify_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY menus_tenant_isolation ON shopify_menus
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_menus FORCE ROW LEVEL SECURITY;

-- shopify_menu_items
ALTER TABLE shopify_menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_items_tenant_isolation ON shopify_menu_items
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE shopify_menu_items FORCE ROW LEVEL SECURITY;
```

### Module L: Scraper Management (Global - Admin Only)

```sql
-- Scraper tables are GLOBAL admin tools, not per-tenant
-- NO RLS policies - access controlled at application layer
-- Only admin users can access scraper_configs, scraper_runs, scraper_queue
```

### Module M: Analytics

```sql
-- analytics_daily_shop
ALTER TABLE analytics_daily_shop ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_daily_tenant_isolation ON analytics_daily_shop
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE analytics_daily_shop FORCE ROW LEVEL SECURITY;

-- analytics_product_performance
ALTER TABLE analytics_product_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_perf_tenant_isolation ON analytics_product_performance
  USING (shop_id = current_setting('app.current_shop_id', true)::uuid);
ALTER TABLE analytics_product_performance FORCE ROW LEVEL SECURITY;
```

---

## UUIDv7 Function (PostgreSQL 18.1 Native)

```sql
-- PostgreSQL 18.1 has native uuidv7() support
-- For older versions, use this polyfill:
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
  uuid_bytes := overlay(unix_ts_ms placing gen_random_bytes(10) from 7);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Test UUIDv7 generation
-- SELECT uuidv7(), uuidv7(), uuidv7();
```

---

## Session Variables (Application Context)

> **Purpose:** Pass context from application to database for RLS and audit logging

### Required Session Variables

| Variable | Type | Purpose | Set By |
| -------- | ---- | ------- | ------ |
| `app.current_shop_id` | UUID | Current tenant for RLS filtering | Application (per request) |
| `app.current_user_id` | UUID | Current user for audit trail | Application (after auth) |
| `app.trace_id` | TEXT | Request trace ID for observability | Application (from headers) |

### Setting Session Variables

```sql
-- Per-transaction context (recommended for RLS)
BEGIN;
SET LOCAL app.current_shop_id = '018d1234-5678-7000-8000-000000000001';
SET LOCAL app.current_user_id = '018d1234-5678-7000-8000-000000000002';
SET LOCAL app.trace_id = 'req-abc123-xyz789';

-- Your queries here - RLS policies will automatically filter by shop_id
SELECT * FROM shopify_products; -- Only returns products for current shop

COMMIT; -- Variables are cleared after transaction
```

### Application Integration (Node.js Example)

```typescript
// Fastify middleware to set RLS context
async function withShopContext<T>(
  pool: Pool,
  shopId: string,
  userId: string | null,
  traceId: string | null,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_shop_id = $1`, [shopId]);
    if (userId) {
      await client.query(`SET LOCAL app.current_user_id = $1`, [userId]);
    }
    if (traceId) {
      await client.query(`SET LOCAL app.trace_id = $1`, [traceId]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

### Custom Parameter Registration

```sql
-- These parameters are set in postgresql.conf or via ALTER SYSTEM
-- Or initialized per-session if not pre-registered

-- For development, initialize with empty defaults
DO $$
BEGIN
  PERFORM set_config('app.current_shop_id', '', false);
  PERFORM set_config('app.current_user_id', '', false);
  PERFORM set_config('app.trace_id', '', false);
EXCEPTION WHEN OTHERS THEN
  -- Parameters not pre-registered, will be created on first SET
  NULL;
END $$;
```

---

## Materialized View Refresh Strategy

> **Purpose:** Define when and how to refresh MVs for optimal performance

### Refresh Schedule

| Materialized View | Refresh Frequency | Trigger | Notes |
| ----------------- | ----------------- | ------- | ----- |
| `inventory_current` | After bulk operations | Manual/Job | CONCURRENTLY after bulk imports |
| `mv_shop_summary` | Hourly | Cron job | Low impact, fast refresh |
| `mv_low_stock_alerts` | Every 15 minutes | Cron job | Critical for inventory alerts |
| `mv_top_sellers` | Daily at 03:00 | Cron job | Heavy query, run off-peak |

### Refresh Jobs (BullMQ)

```typescript
// packages/jobs/src/mv-refresh.ts
const mvRefreshSchedule = [
  { name: 'refresh_inventory_current', cron: '*/30 * * * *', priority: 1 },
  { name: 'refresh_shop_summary', cron: '0 * * * *', priority: 2 },
  { name: 'refresh_low_stock', cron: '*/15 * * * *', priority: 1 },
  { name: 'refresh_top_sellers', cron: '0 3 * * *', priority: 3 },
];
```

### Manual Refresh Commands

```sql
-- Safe concurrent refresh (no locking reads)
REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_current;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_shop_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_low_stock_alerts;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_sellers;

-- Force full refresh (blocks reads, use off-peak)
REFRESH MATERIALIZED VIEW inventory_current;
```

### Monitoring Refresh Status

```sql
-- Check last refresh time (approximate via pg_stat_user_tables)
SELECT 
  schemaname,
  relname as mv_name,
  last_analyze as last_refresh_approx,
  n_live_tup as row_count
FROM pg_stat_user_tables 
WHERE relname LIKE 'mv_%' OR relname = 'inventory_current';
```

---

## Partitioning Strategies

### Monthly Partitioning for High-Volume Tables

```sql
-- audit_logs partitioning
CREATE TABLE audit_logs (
  id UUID DEFAULT uuidv7(),
  shop_id UUID,
  -- ... other columns
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create partitions (automate via pg_partman or cron)
CREATE TABLE audit_logs_2025_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE audit_logs_2025_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- inventory_ledger partitioning
CREATE TABLE inventory_ledger (
  -- ... columns
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (recorded_at);

-- prod_raw_harvest partitioning
CREATE TABLE prod_raw_harvest (
  -- ... columns
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (fetched_at);
```

### Partition Maintenance

```sql
-- Retention policy: drop partitions older than 24 months
DROP TABLE IF EXISTS audit_logs_2023_01;

-- Automatic partition creation (via cron job)
-- Run monthly: SELECT create_next_partition('audit_logs', '1 month');
```

---

## Index Optimization Guidelines

### Partial Indexes for NULLable Columns

```sql
-- Only index non-null SKUs
CREATE INDEX idx_variants_shop_sku ON shopify_variants(shop_id, sku) 
  WHERE sku IS NOT NULL;

-- Only index products needing review
CREATE INDEX idx_master_review ON prod_master(needs_review) 
  WHERE needs_review = true;

-- Only index active items
CREATE INDEX idx_products_active ON shopify_products(shop_id, updated_at) 
  WHERE status = 'ACTIVE';
```

### Composite Indexes for RLS

```sql
-- shop_id FIRST for partition pruning with RLS
CREATE INDEX idx_products_shop_status ON shopify_products(shop_id, status);
CREATE INDEX idx_orders_shop_date ON shopify_orders(shop_id, created_at_shopify DESC);
```

### HNSW Index Parameters for 1M+ Products

```sql
-- Optimized for large datasets
CREATE INDEX idx_embeddings_vector ON prod_embeddings 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m=32, ef_construction=128);

-- At query time: SET hnsw.ef_search = 100;
```

### High-Velocity Performance Indexes (P1.3)

> **Added 2025-12-25** - Indexes for common query patterns identified in audit

```sql
-- Inventory ledger (high-velocity tracking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_shop_variant_date 
    ON inventory_ledger(shop_id, variant_id, recorded_at DESC);

-- Orders (processed filter for analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_processed 
    ON shopify_orders(shop_id, processed_at DESC) 
    WHERE processed_at IS NOT NULL;

-- Audit logs (investigation queries by actor)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_actor 
    ON audit_logs(actor_type, actor_id);

-- Embeddings (dedup queries for current combined type)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embeddings_product_current 
    ON prod_embeddings(product_id) 
    WHERE embedding_type = 'combined';
```

> **Note:** Use `CONCURRENTLY` to avoid table locks in production.

---

## Table Summary

| Module                  | Tables                | Purpose                                                     |
| ----------------------- | --------------------- | ----------------------------------------------------------- |
| A: System Core          | 9                     | Multi-tenancy, auth, sessions, OAuth, feature flags, config |
| B: Shopify Mirror       | 9                     | Shopify data sync + webhook events                          |
| C: Bulk Operations      | 6                     | Bulk import staging                                         |
| D: Global PIM           | 8+4+2 = 14            | Product info + proposals + dedup + translations + similarity matches + quality events |
| E: Normalization        | 4                     | Attributes, PIM vectors + per-shop embeddings               |
| F: AI Batch             | 3                     | AI processing jobs + embedding batches                      |
| G: Queue                | 4                     | Job tracking + rate limiting                                |
| H: Audit                | 2                     | Observability                                               |
| I: Inventory            | 2+1 MV                | High-velocity inventory tracking                            |
| J: Media & Publications | 5                     | Shopify media, channels                                     |
| K: Menus                | 2                     | Navigation structures                                       |
| L: Scraper              | 4 + 1 View            | Web scraping management + API cost tracking                 |
| M: Analytics            | 2+6 MVs               | Precomputed metrics + dashboard MVs + PIM progress MVs      |
| **Total**               | **66 tables + 7 MVs + 1 View** |                                                      |

### New Tables Added (v2.6)

| Table | Module | Purpose |
| ----- | ------ | ------- |
| `prod_similarity_matches` | D | Store external product matches from broad search (95-100% similarity) |
| `prod_quality_events` | D | Track quality level changes for audit trail and webhooks |
| `api_usage_log` | L | Track external API usage and costs for budget management |

### New Views Added (v2.6)

| View | Module | Purpose |
| ---- | ------ | ------- |
| `v_api_daily_costs` | L | Aggregated daily costs per API provider |

### New MVs Added (v2.6)

| Materialized View | Module | Purpose |
| ----------------- | ------ | ------- |
| `mv_pim_quality_progress` | M | PIM quality level distribution (bronze/silver/golden) |
| `mv_pim_enrichment_status` | M | Track enrichment progress from external sources |
| `mv_pim_source_performance` | M | Track which sources provide best quality matches |

---

## Migration Order

> **Dependency-aware migration sequence for drizzle-kit**

```text
1. Extensions (pgcrypto, citext, pg_trgm, btree_gin, btree_gist, vector)
2. UUIDv7 function (if not PG18.1)
3. Module A: shops → staff_users → app_sessions
4. Module B: shopify_products → shopify_variants → shopify_collections → ...
5. Module C: bulk_runs → bulk_steps → bulk_artifacts → bulk_errors → staging_*
6. Module D: prod_taxonomy → prod_sources → prod_raw_harvest → prod_master → ...
7. Module E: prod_attr_definitions → prod_attr_synonyms → prod_embeddings → shop_product_embeddings
8. Module F: ai_batches → ai_batch_items
9. Module G: job_runs → scheduled_tasks
10. Module H: audit_logs → sync_checkpoints
11. Module I: inventory_locations → inventory_ledger → inventory_current (MV)
12. Module J: shopify_media → shopify_product_media → shopify_publications → ...
13. Module K: shopify_menus → shopify_menu_items
14. Module L: scraper_configs → scraper_runs → scraper_queue
15. Module M: analytics_daily_shop → analytics_product_performance
16. RLS Policies (all tables)
17. Partitioning setup (audit_logs, inventory_ledger, prod_raw_harvest)
```

---

## Audit Trail Triggers (CONFORM AUDIT 2025-12-26)

> **Automatic audit logging for critical tables**

### Trigger Function

```sql
-- Generic audit trigger function
-- Requires session variables: app.current_shop_id, app.current_user_id (set by application)
CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
DECLARE
  old_data JSONB;
  new_data JSONB;
  shop_uuid UUID;
  user_uuid UUID;
BEGIN
  -- Get current context from session variables
  shop_uuid := NULLIF(current_setting('app.current_shop_id', true), '')::uuid;
  user_uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  
  IF TG_OP = 'DELETE' THEN
    old_data := to_jsonb(OLD);
    new_data := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    old_data := NULL;
    new_data := to_jsonb(NEW);
  END IF;
  
  INSERT INTO audit_logs (
    shop_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values,
    request_id,
    created_at
  ) VALUES (
    shop_uuid,
    user_uuid,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    old_data,
    new_data,
    NULLIF(current_setting('app.trace_id', true), ''),
    now()
  );
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Tables with Audit Triggers

```sql
-- Critical tables requiring audit trail
CREATE TRIGGER shops_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shops
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER staff_users_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER shopify_products_audit_trigger
  AFTER UPDATE OR DELETE ON shopify_products
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER prod_master_audit_trigger
  AFTER UPDATE OR DELETE ON prod_master
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER key_rotations_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON key_rotations
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

-- Note: INSERT on high-volume tables (webhooks, inventory) excluded to avoid bloat
```

### Audit Log Table Reference

> See Module H: `audit_logs` table for schema definition

---

## Version History

| Version | Date       | Changes                                                                               |
| ------- | ---------- | ------------------------------------------------------------------------------------- |
| v1.0    | 2025-12-20 | Initial schema (33 tables)                                                            |
| v2.0    | 2025-12-23 | Added Modules I-M, PIM extensions, RLS complete, data type mapping (51 tables)        |
| v2.2    | 2025-12-23 | Added shop_product_embeddings, complete RLS for all modules                           |
| v2.3    | 2025-12-23 | Audit fixes: table counts, ai_batches RLS naming, Module D reorder (53 tables + 1 MV) |
| v2.4    | 2025-12-25 | +10 tables from audit, +3 MVs. Total: 63 tables + 4 MVs                               |
| v2.5    | 2025-12-29 | Critical review fixes: audit_logs trigger alignment, CHECK constraints, nullable SKU/barcode, shop_id in junction tables, staging tables complete docs, session variables, MV refresh strategy, timezone/currency in shops |
| v2.6    | 2025-12-29 | **Golden Record Strategy Gaps Fix:** +3 tables (prod_similarity_matches, prod_quality_events, api_usage_log), +1 view (v_api_daily_costs), +5 columns in prod_master (data_quality_level enum, quality_score_breakdown, timestamps), +3 MVs for PIM progress metrics. Total: 66 tables + 7 MVs + 1 View |