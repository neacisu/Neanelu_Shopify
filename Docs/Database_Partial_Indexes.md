# PostgreSQL - Partial Indexes (Documentatie)

Partial index = index cu `WHERE ...` care indexeaza doar un subset de randuri. Beneficii:

- reduce dimensiunea indexului
- imbunatateste performanta pe interogari care filtreaza exact acel subset
- evita indexarea inutila a valorilor `NULL` sau a starilor "inactive"

Acest proiect foloseste partial indexes in migrari (in `packages/database/drizzle/migrations/`) pentru hot paths.

## Exemple (selectie)

### OAuth / securitate

- `oauth_states`: `idx_oauth_states_expires` pe `expires_at` unde `used_at IS NULL`
  - optimizeaza curatarea/validarea doar pentru stari nefolosite.

### Job tracking / orchestrare

- `job_runs`: indexuri pe `group_id` doar unde `group_id IS NOT NULL`
- `job_runs`: `idx_job_runs_priority` pe `(priority, created_at)` unde `status = 'pending'`
  - optimizeaza scheduler/poller pentru coada de pending.
- `scheduled_tasks`: `idx_scheduled_active` pe `(is_active, next_run_at)` unde `is_active = true`

### PIM / Similarity / Webhooks

- `prod_similarity_matches`
  - `idx_similarity_gtin` pe `source_gtin` unde `source_gtin IS NOT NULL`
  - `idx_similarity_score` pe `similarity_score DESC` unde `similarity_score >= 0.95`
  - `idx_similarity_pending` pe `match_confidence` unde `match_confidence = 'pending'`
- `prod_quality_events`
  - `idx_quality_events_pending_webhook` pe `created_at` unde `webhook_sent = false`
    - optimizeaza sweep/retry pentru livrari neexpediate.

### Scraper

- `scraper_queue`
  - `idx_scraper_queue_pending` pe `(config_id, priority DESC, created_at)` unde `status = 'pending'`
  - `idx_scraper_queue_next` pe `next_attempt_at` unde `status = 'pending'`
    - optimizeaza alegerea urmatorului job de executat.

### Audit & observabilitate

- `audit_logs`: `idx_audit_trace` pe `trace_id` unde `trace_id IS NOT NULL`
  - optimizeaza troubleshooting pe request tracing.

### Shopify data

- `shopify_orders`: indexuri pe `email`, `customer_id`, `processed_at` doar unde valorile sunt prezente
- `shopify_product_media`: index pe `product_id` unde `is_featured = true`

## Reguli practice folosite aici

- Partial index doar daca query-ul are acelasi `WHERE` in majoritatea cazurilor.
- Cand `NULL` este frecvent si query-urile filtreaza `IS NOT NULL`, folosim index partial.
- Cand exista stari boolean/enum (ex: `pending`, `is_active=true`, `webhook_sent=false`), index partial este preferat fata de un index complet.
