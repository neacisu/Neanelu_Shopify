# Arhitectura Bază de Date E-Commerce Enterprise (Full Stack Scope)

**Rol:** Arhitect Principal de Baze de Date & System Designer  
**Sistem:** "Neanelu" – High-Volume E-Commerce Middleware & Global PIM System  
**Bază de date:** PostgreSQL 18.1 (Hibrid Relațional + JSONB + pgvector)

---

## 1. Fundația Sistemului & Constrângeri

Această arhitectură este proiectată pentru a servi simultan ca **Shopify Enterprise Middleware** (sincronizare volume masive) și **Global Data Factory** (PIM AI).

**Principii de Design:**

1. **Multi-tenancy Strict:** Izolare la nivel de rând (RLS) bazată pe `shop_id` (UUIDv7).
2. **Performanță Hibridă:** Date critice relaționale, date flexibile JSONB.
3. **Inteligență Vectorială:** Deduplicare și normalizare semantică nativă în DB.
4. **Async-First:** Scriere rapidă (Ledger) și procesare în fundal.

---

## 2. Arhitectura Detaliată pe Module

### MODUL A: System Core & Multi-tenancy (Coloana Vertebrală)

Acesta este stratul de securitate și identitate. Toate tabelele de aici au `shop_id` (cu excepția `shops`, `oauth_states`, `feature_flags`, `system_config`) și impun RLS.

**Diagrama ER (Textuală):**

* **`shops`** (`id` UUIDv7 PK, `shopify_domain` CITEXT UNIQUE, `plan_tier` VARCHAR, `access_token_ciphertext` BYTEA Encrypted, `webhook_secret` BYTEA, `api_version` VARCHAR, `timezone` VARCHAR, `currency_code` VARCHAR)
  * *Sursa Adevărului pentru Tenanți. Coloane noi pentru rate limiting și webhook validation.*
* **`staff_users`** (`id` UUIDv7 PK, `shop_id` FK, `email` CITEXT, `role` JSONB)
  * *Utilizatori cu acces la Dashboard.*
* **`app_sessions`** (`id` VARCHAR PK, `shop_id` FK, `payload` JSONB, `expires_at` TIMESTAMPTZ)
  * *Stocarea sesiunilor OAuth (compatibil Shopify App Bridge).*
* **`oauth_states`** (`id` UUIDv7 PK, `state` VARCHAR UNIQUE, `shop_domain` CITEXT, `nonce` VARCHAR, `expires_at` TIMESTAMPTZ)
  * *CSRF protection pentru OAuth flow. Fără RLS - date pre-autentificare.*
* **`oauth_nonces`** (`id` UUIDv7 PK, `nonce` VARCHAR UNIQUE, `shop_id` FK, `expires_at` TIMESTAMPTZ)
  * *Replay attack protection pentru OAuth.*
* **`key_rotations`** (`id` UUIDv7 PK, `key_version_old` INT, `key_version_new` INT, `status` VARCHAR, `records_updated` INT)
  * *Audit trail pentru rotația cheilor de criptare.*
* **`feature_flags`** (`id` UUIDv7 PK, `flag_key` VARCHAR UNIQUE, `default_value` BOOLEAN, `rollout_percentage` INT, `conditions` JSONB)
  * *Feature flag-uri pentru rollout controlat. Nu are RLS - global.*
* **`system_config`** (`key` VARCHAR PK, `value` JSONB, `is_sensitive` BOOLEAN)
  * *Configurații persistente la nivel de sistem.*
* **`migration_history`** (`id` UUIDv7 PK, `migration_name` VARCHAR UNIQUE, `checksum` VARCHAR, `applied_at` TIMESTAMPTZ)
  * *Tracking migrații DB pentru zero-downtime deploys.*

**Soluția RLS (Row Level Security):**

* **Problema:** JOIN-urile în politicile RLS omoară performanța.
* **Decizia:** **Denormalizare Agresivă.** Coloana `shop_id` va fi prezentă în **TOATE** tabelele de volum mare (`products`, `orders`, `logs`).
* **Implementare:**

    ```sql
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON products
    USING (shop_id = current_setting('app.current_shop_id')::uuid);
    -- Fără JOIN-uri, doar verificare scalară rapidă.
    ```

---

### MODUL B: "Oglinda Shopify" (High-Performance Sync)

Oglinda locală pentru datele din Shopify, optimizată pentru Citire, Filtrare și Căutare. Scrierile vin din Webhooks/Bulk Ops.

**Diagrama ER:**

* **`shopify_products`** (`id` UUIDv7 PK, `shop_id` FK, `shopify_gid` BIGINT UNIQUE, `title` TEXT, `metafields` JSONB)
* **`shopify_variants`** (`id` UUIDv7 PK, `product_id` FK, `sku` TEXT, `price` DECIMAL, `inventory_item_id` BIGINT)
* **`shopify_metaobjects`** (`id` UUIDv7 PK, `type` TEXT, `handle` TEXT, `fields` JSONB)
* **`webhook_events`** (`id` UUIDv7, `shop_id` FK, `topic` VARCHAR, `payload` JSONB, `hmac_verified` BOOLEAN, `processed_at` TIMESTAMPTZ)
  * *Coadă async pentru webhook-uri. Partitionată lunar.*
  * *Pattern: Receive → Queue → Process. Permite retry și observability.*

**Strategia JSONB vs Coloane:**

* **Metafield-uri:** Se stochează într-o **singură coloană `metafields` JSONB** per produs.
  * *Motiv:* PostgreSQL 18.1 cu index GIN (`jsonb_path_ops`) permite filtrarea a 1M produse în milisecunde. Un tabel relațional `attribute_values` ar genera miliarde de rânduri și JOIN-uri imposibile.
* **Date Complexe (Bulk Ops):**
  * Fișierele JSONL parțiale sunt stocate temporar în **tabele UNLOGGED** (`staging_bulk_data`) pentru viteză, procesate în `batch`, apoi șterse.

**Strategia de Inventar (High-Velocity):**

* **Problema:** Locking pe `inventory_level` la 50 update-uri/sec.
* **Soluția:** **Inventory Ledger (Append-Only).**
  * Nu facem `UPDATE quantity SET val = 5`.
  * Facem `INSERT INTO inventory_ledger (sku, delta) VALUES ('SKU1', -1)`.
  * Stocul curent = Suma intrărilor (calculată async sau via Materialized View).

**Strategia de Rate Limiting (Shopify API):**

* **`rate_limit_buckets`** (`shop_id` UUID PK, `tokens_remaining` DECIMAL, `max_tokens` DECIMAL, `refill_rate` DECIMAL, `last_refill_at` TIMESTAMPTZ)
  * *Token bucket persistent per shop.* Sincronizat cu Redis pentru citiri rapide.
* **`api_cost_tracking`** (`id` UUIDv7, `shop_id` FK, `operation_type` VARCHAR, `actual_cost` INT, `throttle_status` VARCHAR, `requested_at` TIMESTAMPTZ)
  * *Partitionată lunar.* Tracking pentru GraphQL cost analysis și alertare.

---

### MODUL C: Global Research PIM ("Fabrica de Date")

Motorul AI de îmbogățire a datelor. Funcționează pe modelul "4 Straturi".

**Structura Celor 4 Straturi:**

1. **Governance:**
    * **`prod_taxonomy`** (`id` UUIDv7, `parent_id` UUIDv7, `name` TEXT, `attribute_schema` JSONB)
    * *Importat din Shopify Standard Taxonomy.* Definește regulile.
2. **Raw Ingestion (Data Lake):**
    * **`prod_raw_harvest`** (`id` UUIDv7, `source_url` TEXT, `raw_html` TEXT, `fetched_at` TIMESTAMPTZ)
    * *Append-only.* Păstrează sursa brută pentru audit și re-procesare.
3. **Process (AI Workspace):**
    * **`prod_extraction_sessions`** (`id` UUIDv7, `harvest_id` FK, `extracted_data` JSONB, `ai_model` TEXT)
    * *Opiniile Agenților.* Aici rulează Consensul.
4. **Golden Record (Production):**
    * **`prod_core`** (`id` UUIDv7 PK, `internal_sku` TEXT UNIQUE)
        * *Identitatea Internă.*
    * **`prod_specs_normalized`** (`product_id` FK, `specs` JSONB, `provenance` JSONB)
        * *Datele curate.*

**Link-ul cu Shopify:**

* **Relație 1:N.** Un produs din `prod_core` (ex: "iPhone 13") poate fi legat de mai multe produse `shopify_products` (dacă vindem în mai multe magazine/regiuni), sau 1:1.
* Se folosește tabela de legătură **`prod_channel_mappings`** (`core_id`, `channel_product_id`, `sync_status`).

---

### MODUL D: Normalizarea Atributelor & Vectori (Inteligența)

Sistemul care înțelege că "Ecran" == "Display".

**Diagrama ER:**

* **`prod_attr_registry`** (`id` UUIDv7 PK, `code` TEXT UNIQUE, `label` TEXT, `embedding` vector(1536))
  * *Atributele Canonice (ex: 'screen_size').*
* **`prod_attr_synonyms`** (`synonym` TEXT PK, `registry_id` FK, `confidence` FLOAT)
  * *Dicționarul de Sinonime.*
* **`prod_embeddings`** (`id` UUIDv7 PK, `product_id` FK, `embedding_type` ENUM, `embedding` vector(1536), `content_hash` TEXT)
  * *Vectorii de produs pentru deduplicare și căutare.*
* **`embedding_batches`** (`id` UUIDv7 PK, `shop_id` FK, `batch_type` VARCHAR, `status` VARCHAR, `openai_batch_id` VARCHAR, `model` VARCHAR, `dimensions` INT)
  * *Tracking OpenAI Batch Embeddings API.* Procesare async pentru costuri reduse (50% discount).
  * *Batch types:* product_title, product_description, specs, combined, attribute.

**Strategia Vectorială (Deduplicare Fuzzy):**

* **Nu stocăm vectori pentru orice.** Stocăm vectori doar pentru:
    1. **Definiții de Atribute** (pentru normalizare schemă).
    2. **Titluri/Descrieri Produse** (în `prod_embeddings` table) pentru a găsi duplicate de produse.
* **Flux Anti-Duplicare:**
    1. Produs nou scrapuit -> Generare Embedding Titlu.
    2. Query HNSW (`vector <-> embedding`) în `prod_embeddings`.
    3. Dacă distanța < 0.05 -> Este duplicat. Linkuim la `prod_core` existent.
    4. Dacă distanța > 0.05 -> Creăm `prod_core` nou.
* **Batch Processing Flow:**
    1. Produse noi colectate în `embedding_batches` (status: pending).
    2. La 1000+ items sau scheduler -> Submit to OpenAI Batch API.
    3. Poll pentru completare -> Download results -> Insert în `prod_embeddings`.
    4. Cost savings: 50% vs real-time embedding calls.

---

## 3. Raport Tehnic & Decizii Finale

1. **JSONB Strategy:**
    * Folosim **JSONB** pentru orice date care variază structural (Metafields, Specs, Raw Data).
    * Folosim **Coloane** pentru date folosite în JOIN-uri, RLS sau Sortare primară (Preț, SKU, Data Creării).
    * *Motiv:* Flexibilitate maximă fără pierderi de performanță în PG 18.1.

2. **Logica Anti-Duplicare:**
    * **Primary:** Cod de Bare (GTIN/EAN) dacă există.
    * **Secondary:** Vector Search pe Titlu + Brand.
    * **Validation:** Reguli hard (ex: Diferență de preț > 50% => Suspicious, flag for human review).

3. **Strategia de Inventar:**
    * Folosim modelul **Ledger (Log-based)** pentru scrieri non-blocante.
    * Calculăm stocul "read-time" sau folosim un tabel de snapshot actualizat asincron pentru interogări rapide.

4. **Strategia de Partitionare:**
    * **Monthly Partitions:** `audit_logs`, `inventory_ledger`, `prod_raw_harvest`, `webhook_events`, `api_cost_tracking`.
    * **Retention policies:** 24 luni pentru audit, 7 zile pentru api_cost_tracking, 3 luni pentru webhook_events.
    * **Automatic partition creation:** Cron job lunar cu `pg_partman` sau script custom.

5. **Schema Summary (v2.4):**
    * **Total Tables:** 63 + 4 Materialized Views
    * **Modules:** A (9), B (9), C (6), D (12), E (4), F (3), G (4), H (2), I (3), J (5), K (2), L (3), M (5)
    * **Key Extensions:** pgvector, pg_trgm, btree_gin, btree_gist, citext

Această arhitectură oferă fundația solidă pentru a scala la 1.7M produse, menținând securitatea și integritatea datelor.
