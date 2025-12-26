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

| Serviciu | Port Dev | Port Prod | Intern/Extern | Note |
|----------|----------|-----------|---------------|------|
| Backend API (Fastify) | 65000 | 65000 | Extern (via Traefik) | Health: /health/ready |
| Frontend Web Admin | 65001 | N/A | Intern | Servit de backend în prod |
| Worker (nu expune port) | N/A | N/A | N/A | Comunică doar via Redis |

### Data Services (651xx)

| Serviciu | Port Dev | Port Prod | Intern/Extern | Note |
|----------|----------|-----------|---------------|------|
| PostgreSQL 18.1 | 65010 | N/A | Intern only în prod | Container name: `postgres` |
| Redis 8.4 | 65011 | N/A | Intern only în prod | Container name: `redis` |

### Observability Services (652xx)

| Serviciu | Port Dev | Port Prod | Intern/Extern | Note |
|----------|----------|-----------|---------------|------|
| Jaeger UI | 65020 | 65020 | Admin only | Traces visualization |
| Jaeger Collector gRPC | 65021 | N/A | Intern | OTLP gRPC receiver |
| OTel Collector OTLP | 65022 | 65022 | Intern | App → Collector |
| Loki | 65023 | N/A | Intern | Logs aggregation |
| Grafana | 65024 | 65024 | Admin only | Dashboards |
| Prometheus | 65025 | 65025 | Admin only | Metrics storage |

### Admin/Debug Tools (653xx)

| Serviciu | Port Dev | Port Prod | Intern/Extern | Note |
|----------|----------|-----------|---------------|------|
| PgAdmin (opțional) | 65030 | N/A | Dev only | DB admin GUI |
| Redis Commander (opțional) | 65031 | N/A | Dev only | Redis admin GUI |
| Bull Board (opțional) | 65032 | N/A | Dev only | Queue monitoring |

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
APP_PORT=65000
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

În producție, doar porturile esențiale sunt expuse prin Traefik reverse proxy:

| Path | Target | Port |
|------|--------|------|
| `/` | backend-api | 65000 |
| `/grafana` | grafana | 65024 |
| `/jaeger` | jaeger | 65020 |

Toate celelalte servicii comunică pe rețeaua internă Docker (`internal_net`).

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

| Data | Schimbare |
|------|-----------|
| 2025-12-26 | Document creat conform audit |


