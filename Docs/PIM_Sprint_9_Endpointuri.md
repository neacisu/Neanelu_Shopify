# PIM Sprint 9 - Endpointuri (Backend Worker)

Acest document listeaza endpointurile PIM adaugate/actualizate in Sprint 9 (API-ul din `apps/backend-worker`).

Note generale:
- Toate endpointurile de mai jos sunt sub prefixul `/api` in productie (ex: `/api/pim/stats/...`), dar sunt inregistrate si fara prefix pentru compatibilitate interna.
- Majoritatea endpointurilor cer sesiune (`requireSession` / `requireAdminSession`) si sunt multi-tenant safe (filtrare dupa `shop_id` + `prod_channel_mappings`).
- Raspunsurile sunt in format envelope: `{ success, data|error, meta }`.

## PIM - Stats, Events, Notificari

- `GET /pim/stats/enrichment-progress`
  - KPI pentru pipeline-ul de enrichment (progress, counts, interval).
- `GET /pim/stats/quality-distribution`
  - Distributie niveluri calitate (bronze/silver/golden/review_needed).
- `GET /pim/stats/source-performance`
  - Statistici per sursa (din MV-uri tenant-aware).
- `GET /pim/stats/enrichment-sync`
  - Statistici sync/enrichment (din MV-uri tenant-aware).

- `GET /pim/stats/cost-tracking`
  - Cost tracking per provider (serper/xai/openai), agregari + trend.
- `GET /pim/stats/cost-tracking/budget-status`
  - Status bugete (used/limit/remaining/ratio/alert).
- `GET /pim/stats/cost-tracking/budget-guard-status`
  - Status combinat: bugete + stare cozi cost-sensitive.
- `POST /pim/stats/cost-tracking/pause-enrichment`
  - Pauzeaza coada `pim-enrichment-queue`.
- `POST /pim/stats/cost-tracking/resume-enrichment`
  - Reia coada `pim-enrichment-queue`.
- `POST /pim/stats/cost-tracking/pause-all-cost-queues`
  - Pauzeaza toate cozile marcate cost-sensitive.
- `POST /pim/stats/cost-tracking/resume-all-cost-queues`
  - Reia toate cozile marcate cost-sensitive.

- `GET /pim/events/quality`
  - Timeline cu evenimente de calitate (promovari, praguri, webhook status).

- `GET /pim/notifications`
  - Lista notificari PIM (paginare + filtrare).
- `GET /pim/notifications/unread-count`
  - Numar notificari necitite.
- `PUT /pim/notifications/:id/read`
  - Marcheaza notificare ca citita.

## PIM - Consensus

- `GET /pim/stats/consensus`
  - KPI pentru consens (pending/computed/conflicts/manual_review).
- `GET /pim/consensus/products?status=all|pending|conflicts&page=1&limit=50`
  - Lista produse cu consens/pending/conflicts (tenant-safe prin `prod_channel_mappings`).
- `GET /products/:id/consensus/details`
  - Detalii consens: surse, rezultate, conflicte, provenance, votes.
- `POST /products/:id/consensus/recompute`
  - Recalculeaza consens pentru produs (control-plane).
- `GET /products/:id/consensus/export?format=csv`
  - Export rezultate consens (CSV).
- `GET /products/:id/extraction-sessions`
  - Sesiuni de extractie asociate produsului (tenant-safe).

## Similarity Matches

- `GET /pim/similarity-matches`
  - Lista matches + filtre (pending/confirmed/rejected/ai_audit/hitl).
- `POST /pim/similarity-matches/:id/confirm`
  - Confirma match.
- `POST /pim/similarity-matches/:id/reject`
  - Respinge match.
- `POST /pim/similarity-matches/:id/extract`
  - Porneste extractie (xAI extractor) pentru match.

## Setari - Serper / xAI / Scraper

- `GET /settings/serper`
  - Citeste configuratia Serper per shop.
- `PUT /settings/serper`
  - Update configuratie Serper (enable + budget + rate limits + cache TTL + apiKey optional).
- `POST /settings/serper/health`
  - Test conexiune Serper cu cheia curenta sau o cheie furnizata.

- `GET /settings/xai`
  - Citeste configuratia xAI per shop.
- `PUT /settings/xai`
  - Update configuratie xAI.
- `POST /settings/xai/health`
  - Test conexiune xAI.

- `GET /settings/scraper`
  - Dashboard status coada scraper + configuratii.
- `GET /settings/scraper/sources`
  - Lista `prod_sources` pentru dropdown (shop sources + globale active).
- `POST /settings/scraper/configs`
  - Create scraper config.
- `PUT /settings/scraper/configs/:id`
  - Update scraper config.
- `POST /settings/scraper/configs/:id/deactivate`
  - Dezactiveaza config.
- `POST /settings/scraper/queue/purge-failed`
  - Curata job-uri esuate.
- `POST /settings/scraper/queue/retry-failed`
  - Reincearca job-uri esuate.

## Cozi / DLQ

- `GET /queues`
  - Lista cozi + contori (waiting/active/failed/delayed).
- `GET /queues/:name/jobs?state=...`
  - Paginare job-uri per stare.
- `POST /queues/:name/pause` / `POST /queues/:name/resume`
  - Pauza / reia coada.
- `POST /queues/:name/clean-failed`
  - Curata job-uri esuate (bulk).
- `POST /queues/:name/dlq/replay`
  - Replay din DLQ (`*-dlq`) inapoi in coada originala (selectie pe `jobIds` sau `limit`).

## Webhooks calitate (quality webhooks)

- `GET /pim/webhooks/config`
  - Citeste config webhook calitate per shop.
- `PUT /pim/webhooks/config`
  - Update config (url/secret/enabled/subscribedEvents).
- `GET /pim/webhooks/deliveries`
  - Lista livrari (deliveries) pentru debugging.
- `POST /pim/webhooks/deliveries/:eventId/retry`
  - Retry manual (rate-limited la 1/min per eventId).

## UX / Observabilitate UI

- `POST /ux/events`
  - Persistare evenimente UX (fire-and-forget) in `audit_logs` cu `action = ux:<name>`.

