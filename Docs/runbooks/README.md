# Runbooks Index

Această secțiune conține runbook-uri pentru operațiuni și debugging.

> [!IMPORTANT]
> Toate runbook-urile trebuie testate practic înainte de a fi considerate complete. Un runbook netested este un runbook periculos.

## Runbooks Disponibile

| Runbook                           | Descriere                                             | Ultima actualizare |
| --------------------------------- | ----------------------------------------------------- | ------------------ |
| [TEMPLATE](TEMPLATE.md)           | Template standard pentru crearea de runbook-uri noi   | 2025-01-XX         |
| [logql-queries](logql-queries.md) | Queries LogQL comune pentru debugging în Grafana/Loki | 2025-01-XX         |

## Runbooks Planificate

- `shopify-429-storm.md` - Shopify API rate limit storm
- `bullmq-stalled-jobs.md` - Jobs stuck/stalled în BullMQ
- `postgres-pool-exhaustion.md` - DB pool saturat
- `redis-memory-full.md` - Redis OOM
- `otel-collector-down.md` - Collector indisponibil
- `bulk-operation-timeout.md` - Bulk op timeout
- `oauth-token-expired-mass.md` - Token-uri multiple expirate

## Cum să creezi un runbook nou

1. Copiază `TEMPLATE.md` într-un fișier nou
2. Completează toate secțiunile
3. Testează pașii pe un mediu de staging
4. Adaugă în tabelul de mai sus
5. Obține review de la un coleg

## Convenții

- **Nume fișier:** `problema-descriere.md` (lowercase cu cratimă)
- **Comenzi:** Toate comenzile trebuie să fie copy-paste ready
- **Secrete:** NU include secrete în runbook-uri
- **Escalare:** Fiecare runbook trebuie să aibă o secțiune de escalare
