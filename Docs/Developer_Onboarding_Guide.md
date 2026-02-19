# Ghid Onboarding Developer - NEANELU Shopify Manager

> **Timp estimat:** 30-60 minute  
> **Ultima actualizare:** 26 Decembrie 2025

---

## 🎯 Obiectiv

După parcurgerea acestui ghid, vei putea:

- Rula aplicația local
- Înțelege structura proiectului
- Face primul commit

---

## 📋 Cerințe Preliminare

### Software Necesar

| Software       | Versiune Minimă        | Verificare               |
|----------------|------------------------|--------------------------|
| Node.js        | v24.0.0+ (LTS Krypton) | `node -v`                |
| pnpm           | v10.0.0+               | `pnpm -v`                |
| Docker         | v24.0.0+               | `docker -v`              |
| Docker Compose | v2.20.0+               | `docker compose version` |
| Git            | v2.40.0+               | `git -v`                 |

### Instalare Node.js 24

```bash
# Cu nvm (recomandat)
nvm install 24
nvm use 24
nvm alias default 24

# Verificare
node -v  # Trebuie să afișeze v24.x.x
```

### Instalare pnpm 10

```bash
# Cu corepack (recomandat pentru Node 24+)
corepack enable
corepack prepare pnpm@latest --activate

# Verificare
pnpm -v  # Trebuie să afișeze 10.x.x
```

---

## 🔑 Obținere Credențiale

### 1. NPM Token pentru BullMQ Pro

BullMQ Pro este un pachet privat. Ai nevoie de acces la registry-ul TaskForce.

1. Solicită invitație la contul organizației pe [taskforce.sh](https://taskforce.sh)
2. Acceptă invitația din email
3. Generează un token personal: Dashboard → Account → NPM Tokens
4. Salvează token-ul (îl vei folosi în pasul de configurare)

### 2. Shopify Partner Account

1. Creează cont pe [partners.shopify.com](https://partners.shopify.com)
2. Creează o aplicație de dezvoltare (Custom App)
3. Notează:
   - API Key
   - API Secret
   - Scopes necesare: `read_products`, `write_products`, `read_orders`, `write_orders`, `read_inventory`, `write_inventory`

### 3. OpenAI API Key (opțional pentru dev)

1. Cont pe [platform.openai.com](https://platform.openai.com)
2. Generează API key
3. Notă: Pentru dev poți folosi un key de test cu limite reduse

---

## 🚀 Setup Local

### Pasul 1: Clone Repository

```bash
git clone git@github.com:neacisu/Neanelu_Shopify.git
cd Neanelu_Shopify
```

### Pasul 2: Configurare Environment

```bash
# Single env (oficial): Copiază template-ul și completează valorile reale
cp .env.example .env

# Editează cu valorile tale (în special Shopify + ENCRYPTION_KEY_256 + Traefik dashboard auth)
nano .env
```

**Variabile OBLIGATORII pentru dev:**

```bash
# Database (host tooling)
DATABASE_URL=postgresql://db_owner:password@localhost:65010/neanelu_shopify
DATABASE_URL_DOCKER=postgresql://db_owner:password@db:5432/neanelu_shopify

# Redis (host tooling)
REDIS_URL=redis://localhost:65011
REDIS_URL_DOCKER=redis://redis:6379

# Prefixuri chei (dev defaults)
REDIS_PREFIX=neanelu:dev:
BULLMQ_PREFIX=neanelu:dev:

# Criptare tokens (genereaza cu: openssl rand -hex 32)
ENCRYPTION_KEY_VERSION=1
ENCRYPTION_KEY_256=your_64_char_hex_key_here

# BullMQ Pro NPM Token (din TaskForce.sh)
NPM_TASKFORCESH_TOKEN=your_token_here
BULLMQ_PRO_TOKEN=your_bullmq_pro_license_token

# Shopify (din Partners Dashboard)
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_products,write_products,read_orders

# App Host (URL-ul aplicației) — trebuie să includă schema (DEV local)
APP_HOST=https://localhost:65000

# Hostname only (fără schema) — folosit de Traefik Host() rules (DEV local)
APP_HOSTNAME=localhost

# OpenTelemetry (observabilitate)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:65022
OTEL_EXPORTER_OTLP_ENDPOINT_DOCKER=http://otel-collector:4318

# OpenAI (opțional pentru dev)
OPENAI_API_KEY=sk-your-key-here
```

### Note despre staging/prod (infrastructura noua)

- În staging/prod, `.env` nu se completează manual: secretele vin din OpenBao Agent (fișiere render-izate în `/run/neanelu/runtime-secrets/...`).
- DB runtime merge prin PgBouncer (`DATABASE_URL`), iar migrațiile folosesc conexiune directă (`MIGRATION_DATABASE_URL`) către CT107.
- Redis este shared prin VIP `10.0.1.10:6379` și necesită `REDIS_PREFIX` + `BULLMQ_PREFIX` distincte per environment.

### Rulare teste (fără DB local)

- Rulează toate testele care nu depind de DB/Redis locale:
  - `pnpm test`
- Rulează schema/DB tests cu Testcontainers:
  - `pnpm --filter @app/database test:db`
  - alternativ: `DATABASE_TESTS_WITH_CONTAINERS=1 pnpm --filter @app/database test`

### Pasul 3: Configurare NPM Token

Exportă token-ul pentru sesiunea curentă:

```bash
export NPM_TASKFORCESH_TOKEN="your_actual_token_here"
```

Sau adaugă în `~/.bashrc` / `~/.zshrc` pentru persistență:

```bash
echo 'export NPM_TASKFORCESH_TOKEN="your_token"' >> ~/.bashrc
source ~/.bashrc
```

### Pasul 4: Instalare Dependențe

```bash
pnpm install
```

**Erori comune:**

- `401 Unauthorized` → Token-ul NPM nu e setat corect
- `403 Forbidden` → Nu ai acces la registry-ul BullMQ Pro

### Pasul 5: Configurare Docker Environment

Notă: Docker Compose citește automat fișierul `.env` din root (acesta este env-ul oficial al repo-ului).

Pentru webhooks Shopify pe domeniu public:

- `APP_HOST` trebuie să fie URL complet (ex: `https://manager.neanelu.ro`)
- `APP_HOSTNAME` trebuie să fie hostname (fără `https://`) (ex: `manager.neanelu.ro`)
- host-ul trebuie să poată primi trafic HTTPS standard pe **80/443** (Let's Encrypt ACME HTTP-01)

Dacă portul 65000 este ocupat local, setează `BACKEND_HOST_PORT` în `.env`.

### Pasul 5.1: WebSocket + HTTP/2 (Traefik/Proxy)

Pentru stream‑uri realtime (loguri/queue/evente), aplicația folosește WebSocket. Dacă traficul trece prin Traefik sau un edge proxy:

- WebSocket upgrade trebuie permis (Upgrade/Connection).
- HTTP/2 este OK, dar proxy‑ul trebuie să suporte WS peste H2 fără buffering agresiv.
- Cookie‑urile de sesiune trebuie propagate la handshake; altfel poți folosi token în query:
  - exemplu: `wss://manager.neanelu.ro/api/queues/ws?token=<session_token>`
- Setează timeouts de idle suficient de mari (minim 60s) pentru conexiuni WS.

Verificare rapidă:

```bash
# rulează doar dacă ai token valid
wscat -c "wss://manager.neanelu.ro/api/queues/ws?token=<session_token>"
```

### Pasul 6: Pornire Infrastructură Docker

```bash
# Pornește PostgreSQL, Redis, Jaeger
pnpm run db:up

# Verifică că toate serviciile sunt up
docker compose ps
```

### Pasul 7: Rulare Migrații

```bash
pnpm run db:migrate
```

### Pasul 8: (Opțional) Seed Data

```bash
pnpm run db:seed
```

### Pasul 9: Pornire Aplicație

```bash
# Backend rulează în container (Traefik reverse-proxy + TLS)
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Aplicația va fi disponibilă la:

- Backend API (prin Traefik): `$APP_HOST`
- Frontend Web Admin (prin Traefik): `$APP_HOST/app`
- Health Check (prin Traefik): `$APP_HOST/health/ready`
- Jaeger UI: <http://localhost:65020>

---

## 📁 Structura Proiectului

```text
/Neanelu_Shopify
├── apps/
│   ├── backend-worker/     # API + Worker (Fastify + BullMQ)
│   └── web-admin/          # Frontend Admin (React + RR7)
├── packages/
│   ├── database/           # Drizzle ORM + Schema
│   ├── queue-manager/      # BullMQ Pro wrappers
│   ├── shopify-client/     # Shopify API client
│   ├── ai-engine/          # OpenAI integration
│   ├── config/             # Environment + Config
│   ├── types/              # TypeScript types partajate
│   └── logger/             # OTel + Structured logging
├── Docs/                   # Documentație
└── config/                 # Docker, OTel, etc.
```

---

## 🧪 Rulare Teste

```bash
# Toate testele
pnpm test

# Doar backend (node:test)
pnpm test:backend

# Doar frontend (Vitest)
pnpm test:frontend

# Cu coverage
pnpm test -- --coverage
```

---

## 🔧 Comenzi Utile

| Comandă           | Descriere                    |
|-------------------|------------------------------|
| `pnpm dev`        | Pornește totul în watch mode |
| `pnpm build`      | Build producție              |
| `pnpm lint`       | Verificare ESLint            |
| `pnpm format`     | Formatare Prettier           |
| `pnpm typecheck`  | Verificare TypeScript        |
| `pnpm db:up`      | Pornește Docker containers   |
| `pnpm db:down`    | Oprește Docker containers    |
| `pnpm db:migrate` | Rulează migrații             |
| `pnpm db:studio`  | Deschide Drizzle Studio      |

---

## 🌿 Git Workflow

### Branch Naming

```text
feat/descriere-scurta    # Feature nou
fix/issue-123-descriere  # Bug fix
chore/update-deps        # Mentenanță
```

### Commit Messages (Conventional Commits)

```text
feat: add product sync functionality
fix: resolve webhook timeout issue
docs: update onboarding guide
chore: update dependencies
```

### Pre-commit Hooks

La fiecare commit, Husky rulează automat:

- ESLint
- Prettier
- TypeScript check

Dacă hook-ul eșuează, commit-ul este blocat. Corectează erorile și re-încearcă.

---

## ❓ Troubleshooting

### "Cannot find module @app/database"

```bash
# Rebuild symlinks
pnpm install --force
```

### "Connection refused" la PostgreSQL

```bash
# Verifică că Docker e pornit
docker compose ps

# Repornește
pnpm run db:down
pnpm run db:up
```

### "401 Unauthorized" la pnpm install

```bash
# Verifică token-ul
echo $NPM_TASKFORCESH_TOKEN

# Sau setează-l din nou
export NPM_TASKFORCESH_TOKEN="your_token"
pnpm install
```

### ESLint/Prettier conflicts

```bash
# Resetează formatarea
pnpm format
pnpm lint:fix
```

---

## 📚 Resurse Adiționale

- [Plan de Implementare](./Plan_de_implementare.md) - Source of Truth pentru tasks
- [Stack Tehnologic](./Docs/Stack%20Tehnologic%20Complet%20pnpm%20Shopify.md) - Decizii tehnice
- [Port Conventions](./Docs/Port_Conventions.md) - Porturi servicii
- [Testing Strategy](./Docs/Testing_Strategy.md) - Ghid testare

---

## 🆘 Suport

Dacă ai probleme:

1. Verifică `#dev-help` pe Slack/Discord
2. Caută în issues pe GitHub
3. Contactează maintainer-ul principal

---

> **Bun venit în echipă! 🎉**
