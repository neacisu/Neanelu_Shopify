# Convenții Porturi - NEANELU Shopify Manager

> **Source of Truth pentru toate configurările de porturi**  
> **Ultima actualizare:** 26 Decembrie 2025

---

## Strategia de Numerotare

Toate serviciile folosesc porturi în range-ul **65xxx** pentru a evita conflicte cu servicii standard.

**Format:** `65[GROUP][ID]`

- **65 0 xx** - Application Services
- **65 1 xx** - Data Services (DB, Cache)
- **65 2 xx** - Observability Services
- **65 3 xx** - Admin/Debug Tools

---

## Porturi Definitive

### Application Services (650xx)

| Serviciu                | Port Dev | Port Prod | Intern/Extern        | Note                      |
|-------------------------|----------|-----------|----------------------|---------------------------|
| Backend API (Fastify)   | 65000    | 65000     | Extern (via Traefik) | Health: /health/ready     |
| Frontend Web Admin      | 65001    | 65001     | Extern (via Traefik) | UI: /app (server dedicat) |
| Worker (nu expune port) | N/A      | N/A       | N/A                  | Comunică doar via Redis   |

### Data Services (651xx)

| Serviciu            | Port Dev | Port Prod | Intern/Extern        | Note                      |
|---------------------|----------|-----------|----------------------|---------------------------|
| PostgreSQL 18.1     | 65010    | N/A       | Dev only (local)     | Service name: `db`        |
| Redis 8.4           | 65011    | N/A       | Dev only (local)     | Container name: `redis`   |

### Observability Services (652xx)

| Serviciu              | Port Dev | Port Prod | Intern/Extern | Note                 |
|-----------------------|----------|-----------|---------------|----------------------|
| Jaeger UI             | 65020    | 65020     | Admin only    | Traces visualization |
| Jaeger Collector gRPC | 65021    | N/A       | Intern        | OTLP gRPC receiver   |
| OTel Collector OTLP   | 65022    | 65022     | Intern        | App → Collector      |
| Loki                  | 65023    | N/A       | Intern        | Logs aggregation     |
| Grafana               | 65024    | 65024     | Admin only    | Dashboards           |
| Prometheus            | 65025    | 65025     | Admin only    | Metrics storage      |

### Admin/Debug Tools (653xx)

| Serviciu                   | Port Dev | Port Prod | Intern/Extern | Note             |
|----------------------------|----------|-----------|---------------|------------------|
| PgAdmin (opțional)         | 65030    | N/A       | Dev only      | DB admin GUI     |
| Redis Commander (opțional) | 65031    | N/A       | Dev only      | Redis admin GUI  |
| Bull Board (opțional)      | 65032    | N/A       | Dev only      | Queue monitoring |
| OAuth Callback Helper      | 65033    | N/A       | Dev only      | Research helper  |

---

## Configurare în Docker Compose

### docker-compose.yml (base - fără porturi expuse)

```yaml
services:
  postgres:
    image: postgres:18.1-alpine
    # Nu expunem porturi în base
    
  redis:
    image: redis:8.4
    # Nu expunem porturi în base
```

### docker-compose.dev.yml (override - porturi pentru dev)

```yaml
services:
  postgres:
    ports:
      - "65010:5432"
      
  redis:
    ports:
      - "65011:6379"
      
  jaeger:
    ports:
      - "65020:16686"
      - "65021:4317"
```

---

## Environment Variables

```bash
# Application
PORT=65000
FRONTEND_PORT=65001

# Data Layer
DATABASE_URL=postgresql://user:pass@localhost:65010/neanelu_shopify
REDIS_URL=redis://localhost:65011

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:65022
JAEGER_UI_URL=http://localhost:65020
GRAFANA_URL=http://localhost:65024
```

---

## Producție (Bare Metal)

În producție (infrastructura noua), aplicația rulează pe CT-uri dedicate și folosește servicii shared:

- Postgres: CT107 (direct) + PgBouncer pe CT111/CT112
- Redis: shared (VIP 10.0.1.10:6379)
- Ingress: Traefik pe orchestrator (TLS termination)

Doar porturile esențiale sunt expuse public prin Traefik reverse proxy:

| Path       | Target      | Port  |
|------------|-------------|-------|
| `/`        | backend-api | 65000 |
| `/app`     | web-admin   | 65001 |
| `/grafana` | grafana     | 65024 |
| `/jaeger`  | jaeger      | 65020 |

Toate celelalte servicii comunică pe rețeaua internă Docker (`neanelu_network`).

### Observability exporters (prod/staging/dev)

Exporterele sunt expuse pentru Prometheus central prin VIP (hz.247) cu porturi dedicate:

- Node exporter:
  - prod: `10.0.1.10:29200` -> CT111:9100
  - staging: `10.0.1.10:19200` -> CT112:9100
  - dev: `10.0.1.10:39200` -> hz164:9100
- cAdvisor:
  - prod: `10.0.1.10:29210` -> CT111:65210
  - staging: `10.0.1.10:19210` -> CT112:65210
  - dev: `10.0.1.10:39210` -> hz164:65210
- PgBouncer exporter:
  - prod: `10.0.1.10:29211` -> CT111:65211
  - staging: `10.0.1.10:19211` -> CT112:65211
  - dev: `10.0.1.10:39211` -> hz164:65211

**Network model (standardizat):**

- `neanelu_frontend_network`: ingress + trafic FE↔BE (Traefik + web-admin + backend-worker)
- `neanelu_network`: resurse interne (PostgreSQL/Redis/observability) accesibile doar de backend
- `public_net`: alias compatibil (Traefik only) pentru documentație/implementări mai vechi

**Contract port mapping (dev):**

- `PORT` rămâne **65000** în Compose (container backend expune 65000).
- Dacă ai conflict pe host, schimbă doar `BACKEND_HOST_PORT` (host -> container `${PORT}`).

---

## Troubleshooting

### Port deja în uz

```bash
# Găsește procesul
lsof -i :65010

# Sau cu docker
docker ps --format "{{.Names}}: {{.Ports}}" | grep 65010
```

### Verificare conectivitate

```bash
# PostgreSQL
nc -zv localhost 65010

# Redis
redis-cli -p 65011 ping
```

---

## Changelog

| Data       | Schimbare                    |
|------------|------------------------------|
| 2025-12-26 | Document creat conform audit |
