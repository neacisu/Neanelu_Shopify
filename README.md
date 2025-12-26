# Neanelu Shopify

![Shopify](https://img.shields.io/badge/Shopify-Enterprise-96BF48?style=for-the-badge&logo=shopify&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-v24_LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.1-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-8.4-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10+-F69220?style=for-the-badge&logo=pnpm&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

## Enterprise-grade Shopify Application for 1M+ SKU Management

[Quick Start](#3-quick-start) • [Architecture](#5-architecture) • [Documentation](#9-documentation-index) • [Contributing](#11-contributing)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Features](#2-key-features)
3. [Quick Start](#3-quick-start)
4. [Technology Stack](#4-technology-stack)
5. [Architecture](#5-architecture)
6. [Repository Structure](#6-repository-structure)
7. [Research & Validated Discoveries](#7-research--validated-discoveries)
8. [Development Guide](#8-development-guide)
9. [Documentation Index](#9-documentation-index)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Contributing](#11-contributing)
12. [Security](#12-security)

---

## 1. Overview

**Neanelu Shopify** is an enterprise-grade Shopify application designed to manage massive product catalogs (1M+ SKUs) with advanced features including:

- **Streaming Bulk Operations** - Process gigabytes of JSONL data with constant memory usage
- **Multi-tenant Fairness** - BullMQ Pro Groups ensure no single merchant monopolizes resources
- **AI-Powered Search** - Vector embeddings via OpenAI Batch API + pgvector for semantic search
- **Real-time Sync** - Webhook-driven architecture with cost-based rate limiting

### Current Status

| Component            | Status         | Description                                                   |
| -------------------- | -------------- | ------------------------------------------------------------- |
| **Research Scripts** | ✅ Validated   | TypeScript + Python scripts for Shopify Admin API exploration |
| **Documentation**    | ✅ Complete    | Full architecture, database schema, implementation plan       |
| **Infrastructure**   | ✅ Ready       | Docker Compose with PostgreSQL 18.1, Redis 8.4, Jaeger        |
| **Monorepo Setup**   | 🔄 In Progress | pnpm workspace with ESLint, TypeScript, Husky                 |
| **Backend Worker**   | 📋 Planned     | Phase F3-F5                                                   |
| **Web Admin UI**     | 📋 Planned     | Phase F3 (Frontend)                                           |

---

## 2. Key Features

### 🚀 High-Volume Data Processing

- **Bulk Operations Pipeline**: Streaming JSONL processing (100k-1M+ products)
- **Memory-Efficient Ingestion**: \`pg-copy-streams\` for direct PostgreSQL COPY
- **Parent-Child Stitching**: Automatic \`\_\_parentId\` relationship reconciliation

### 🔐 Enterprise Security

- **Row-Level Security (RLS)**: Multi-tenant data isolation at database level
- **AES-256-GCM Encryption**: Secure token storage with key rotation support
- **OAuth 2.0 Offline Access**: Server-side flow with HMAC validation

### ⚡ Smart Rate Limiting

- **Cost-Based Throttling**: Shopify GraphQL cost tracking per shop
- **Token Bucket Algorithm**: Distributed rate limiting via Redis + Lua
- **Automatic Backoff**: 429 detection with delayed job rescheduling

### 🤖 AI Integration

- **OpenAI Batch API**: Efficient embedding generation for product catalogs
- **pgvector Search**: Semantic similarity search in PostgreSQL
- **Context-Enabled Cache**: Redis exact-match cache for hot queries

### 📊 Observability

- **OpenTelemetry**: Distributed tracing from HTTP → Queue → Database
- **Loki + Grafana**: Centralized logging with LogQL queries
- **Health Dashboards**: Real-time metrics for queues, sync status, API costs

---

## 3. Quick Start

### Prerequisites

- **Node.js** ≥ 24.0.0 (see [.nvmrc](.nvmrc))
- **pnpm** ≥ 10.0.0 (\`corepack enable\`)
- **Docker** + Docker Compose

### Installation

\`\`\`bash
git clone <https://github.com/your-org/Neanelu_Shopify.git>
cd Neanelu_Shopify
pnpm install
cp .env.example .env
pnpm db:up
docker compose ps
\`\`\`

### Available Scripts

| Command            | Description                    |
| ------------------ | ------------------------------ |
| \`pnpm dev\`       | Start all apps in watch mode   |
| \`pnpm build\`     | Build all packages and apps    |
| \`pnpm lint\`      | Run ESLint across workspace    |
| \`pnpm typecheck\` | TypeScript type checking       |
| \`pnpm test\`      | Run tests (node:test + Vitest) |
| \`pnpm db:up\`     | Start Docker infrastructure    |
| \`pnpm db:down\`   | Stop Docker containers         |
| \`pnpm db:logs\`   | Tail container logs            |
| \`pnpm db:clean\`  | Remove containers + volumes    |

---

## 4. Technology Stack

### Runtime & Language

| Technology     | Version           | Purpose                                     |
| -------------- | ----------------- | ------------------------------------------- |
| **Node.js**    | v24 LTS (Krypton) | Server runtime with native ESM, test runner |
| **TypeScript** | 5.9.3             | Type safety, modern decorators              |
| **pnpm**       | 10.x              | Package manager with workspace support      |

### Data Layer

| Technology      | Version | Purpose                                    |
| --------------- | ------- | ------------------------------------------ |
| **PostgreSQL**  | 18.1    | Primary database with JSONB, pgvector, RLS |
| **Redis**       | 8.4     | BullMQ backend, rate limiting, exact cache |
| **Drizzle ORM** | 0.45.x  | Type-safe queries, SQL-first migrations    |

### Processing & Queues

| Technology          | Version | Purpose                           |
| ------------------- | ------- | --------------------------------- |
| **BullMQ Pro**      | 7.x     | Job queues with Groups (fairness) |
| **pg-copy-streams** | 7.x     | High-speed COPY FROM STDIN        |
| **stream-json**     | 1.9.x   | Memory-efficient JSONL parsing    |

### Frontend (Planned)

| Technology                 | Version | Purpose                         |
| -------------------------- | ------- | ------------------------------- |
| **React Router**           | v7      | Full-stack framework (ex-Remix) |
| **Vite**                   | 7.3     | Build tool with HMR             |
| **Polaris Web Components** | 2025-10 | Shopify UI components (CDN)     |
| **Tailwind CSS**           | v4      | Utility-first styling           |

### Observability

| Technology         | Purpose                             |
| ------------------ | ----------------------------------- |
| **OpenTelemetry**  | Distributed tracing + metrics       |
| **Jaeger**         | Trace visualization (dev)           |
| **Loki + Grafana** | Log aggregation + dashboards (prod) |

### Shopify Integration

| API                 | Version | Notes                                       |
| ------------------- | ------- | ------------------------------------------- |
| **Admin GraphQL**   | 2025-10 | Primary API for products, orders, inventory |
| **Bulk Operations** | -       | Required for 1M+ products                   |
| **Webhooks**        | -       | HMAC-validated, async processing            |

---

## 5. Architecture

### High-Level System Design

\`\`\`mermaid
flowchart TB
subgraph Shopify["☁️ Shopify Platform"]
AdminAPI["Admin GraphQL API\n(2025-10)"]
Webhooks["Webhooks\n(HMAC signed)"]
BulkOps["Bulk Operations\n(JSONL export)"]
end

    subgraph Backend["⚙️ Backend (apps/backend-worker)"]
        API["HTTP API\n(Fastify)"]
        OAuth["OAuth Handler\n(offline tokens)"]
        WebhookHandler["Webhook Ingress\n(validate + enqueue)"]
        Workers["Job Workers\n(BullMQ Pro)"]
        BulkPipeline["Bulk Pipeline\n(streaming)"]
    end

    subgraph Data["💾 Data Layer"]
        PG[("PostgreSQL 18.1\n• Drizzle ORM\n• RLS Multi-tenant\n• pgvector")]
        Redis[("Redis 8.4\n• BullMQ Queues\n• Rate Limiting\n• Exact Cache")]
    end

    subgraph AI["🤖 AI Engine"]
        OpenAI["OpenAI Batch API\n(embeddings)"]
    end

    subgraph Frontend["🖥️ Frontend (apps/web-admin)"]
        WebUI["React Router v7\n+ Polaris"]
    end

    subgraph Observability["📊 Observability"]
        OTel["OpenTelemetry\nCollector"]
        Jaeger["Jaeger\n(traces)"]
        Loki["Loki\n(logs)"]
        Grafana["Grafana\n(dashboards)"]
    end

    AdminAPI --> OAuth
    Webhooks --> WebhookHandler
    BulkOps --> BulkPipeline

    API --> Redis
    WebhookHandler --> Redis
    Workers --> PG
    Workers --> Redis
    Workers --> OpenAI
    BulkPipeline --> PG

    PG --> WebUI
    API --> WebUI

    Backend --> OTel
    OTel --> Jaeger
    OTel --> Loki
    Loki --> Grafana
    Jaeger --> Grafana

\`\`\`

### Multi-Tenant Fairness Model

\`\`\`mermaid
flowchart LR
subgraph Jobs["Incoming Jobs"]
J1["Shop A: 100k jobs"]
J2["Shop B: 10 jobs"]
J3["Shop C: 1k jobs"]
end

    subgraph BullMQ["BullMQ Pro Groups"]
        G1["Group A\n(shop_id UUID)"]
        G2["Group B\n(shop_id UUID)"]
        G3["Group C\n(shop_id UUID)"]
    end

    subgraph RoundRobin["⚖️ Fair Scheduler"]
        RR["Round-Robin\nbetween groups"]
    end

    subgraph Workers["Workers (10 instances)"]
        W1["Worker 1"]
        W2["Worker 2"]
        W3["Worker ..."]
    end

    subgraph RateLimit["🚦 Rate Limiting"]
        RL["Per-shop\ntoken bucket"]
    end

    J1 --> G1
    J2 --> G2
    J3 --> G3

    G1 --> RR
    G2 --> RR
    G3 --> RR

    RR --> W1
    RR --> W2
    RR --> W3

    W1 --> RL
    W2 --> RL
    W3 --> RL

\`\`\`

### Bulk Ingest Pipeline

\`\`\`mermaid
flowchart LR
A["📥 Shopify Bulk Op\n(signed URL)"] --> B["🌊 HTTP Stream\n(fetch native)"]
B --> C["📄 JSONL Parser\n(stream-json)"]
C --> D["🔄 Transform\n(normalize)"]
D --> E["🔗 Stitcher\n(__parentId)"]
E --> F["📝 CSV Formatter"]
F --> G["⚡ pg-copy-streams\n(COPY FROM STDIN)"]
G --> H[("💾 PostgreSQL")]

    style A fill:#96BF48
    style H fill:#4169E1

\`\`\`

### OAuth Server-Side Flow

\`\`\`mermaid
sequenceDiagram
participant Browser as Browser/Shopify Admin
participant API as Backend (apps/backend-worker)
participant Shopify as Shopify OAuth
participant PG as PostgreSQL (shops table)

    Browser->>API: GET /auth?shop=example.myshopify.com
    API->>API: Validate shop domain + generate state
    API->>Shopify: Redirect to /admin/oauth/authorize
    Shopify->>Browser: Redirect to /auth/callback?code=...&hmac=...&state=...
    Browser->>API: GET /auth/callback
    API->>API: Verify state + HMAC signature
    API->>Shopify: POST /admin/oauth/access_token
    Shopify-->>API: { access_token, scope }
    API->>PG: Encrypt + store token (AES-256-GCM)
    API-->>Browser: Redirect to app dashboard

\`\`\`

---

## 6. Repository Structure

\`\`\`
Neanelu_Shopify/
├── 📁 apps/ # Applications (planned)
│ ├── backend-worker/ # API + Job workers (Fastify, BullMQ)
│ └── web-admin/ # React Router v7 + Polaris UI
│
├── 📁 packages/ # Shared packages (planned)
│ ├── database/ # Drizzle ORM + migrations
│ ├── queue-manager/ # BullMQ Pro configuration
│ ├── shopify-client/ # GraphQL client wrapper
│ ├── ai-engine/ # OpenAI + pgvector search
│ ├── config/ # Environment validation
│ ├── logger/ # OpenTelemetry logging
│ └── types/ # Shared TypeScript types
│
├── 📁 Docs/ # Technical documentation
│ ├── Database_Schema_Complete.md # 53 tables + RLS policies
│ ├── Strategie_dezvoltare.md # Architecture blueprint
│ ├── Stack Tehnologic Complet*.md # Stack decisions
│ ├── DevOps_Plan_Implementare*.md # DevOps playbook
│ ├── Arhitectura_Frontend\*.md # UI specifications
│ ├── Frontend_Component_Specs.md # Component API doc # Python scripts
│ ├── Outputs/ # Python artifacts
│ └── TSOutputs/ # TypeScript artifacts
│
├── 📁 Research Categorii/ # Category/menu research
│ ├── CatScripts/ # Category extraction scripts
│ └── CatOutputs/ # Menu JSONL/JSON outputs
│
├── 📄 Plan_de_implementare.md # Master implementation plan (F0-F8)
├── 📄 Problems & Fixes.md # Schema audit & 34 identified gaps
├── 📄 docker-compose.yml # Base infrastructure
├── 📄 docker-compose.dev.yml # Development overrides
├── 📄 pnpm-workspace.yaml # Workspace configuration
├── 📄 tsconfig.base.json # Base TypeScript config
├── 📄 eslint.config.js # ESLint flat config
├── 📄 .env.example # Environment template
└── 📄 oauth-callback-server.ts # Research OAuth helper
\`\`\`

---

## 7. Research & Validated Discoveries

> **Important**: These findings are validated through practical testing, not theoretical assumptions. They must be treated as **design constraints**.

### 7.1 OAuth in Headless Environments

| Problem         | Shopify CLI login is unstable/blocked in headless Linux environments                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Solution**    | Manual OAuth flow: generate auth URL → capture redirect with \`code\` → exchange at \`/admin/oauth/access_token\` |
| **Implication** | Production must implement full server-side OAuth (not CLI-dependent)                                              |

See: [oauth-callback-server.ts](oauth-callback-server.ts)

### 7.2 Bulk Operations JSONL Structure

**Discovery**: Bulk exports produce flat JSONL with separate lines for \`Product\` and \`ProductVariant\`:

\`\`\`jsonl
{"id": "gid://shopify/Product/123", "title": "Widget", ...}
{"id": "gid://shopify/ProductVariant/456", "\_\_parentId": "gid://shopify/Product/123", ...}
\`\`\`

| Key Field       | \`\_\_parentId\` links child entities to parents          |
| --------------- | --------------------------------------------------------- |
| **Implication** | Ingest pipeline must perform "stitching" during streaming |

### 7.3 Schema Introspection for Product Fields

| Problem      | Hardcoded field lists become outdated as Shopify evolves the API |
| ------------ | ---------------------------------------------------------------- |
| **Solution** | Query generator using GraphQL schema introspection               |
| **Benefit**  | Automatically adapts to new fields in future API versions        |

### 7.4 Metafields Pagination Required

| Discovery    | \`metafields(first: 250)\` may not return all metafields  |
| ------------ | --------------------------------------------------------- |
| **Solution** | Full pagination with cursor until \`hasNextPage = false\` |

### 7.5 App-Owned Metafields Limitation

> ⚠️ **Critical**: Metafields with namespace \`app--[id]--\*\` are **only visible** to the owning app.

- Staff/Admin tokens cannot read these metafields
- Other apps see empty results
- This is a Shopify platform restriction

**Implication**: If app-owned data is critical, read with owning app's token and replicate to database.

### 7.6 Deterministic Sampling for Debugging

| Purpose     | Enable reproducible debugging and Python ↔ TypeScript parity        |
| ----------- | ------------------------------------------------------------------- |
| **Method**  | Alphabet buckets (A-Z + #) for vendors, first N products per vendor |
| **Benefit** | Eliminates random drift between test runs                           |

---

## 8. Development Guide

### Running Research Scripts

All TypeScript research scripts run via `pnpm exec tsx`:

```bash
cd "Research Produse/Scripts/TScripts"
pnpm install
pnpm exec tsx sample_by_vendor.ts ../../bulk-products.jsonl \
  --k 3 \
  --alphabet-pick \
  --out ../../TSOutputs/vendor_samples_report.json

pnpm exec tsx fetch_shopify_products.ts \
  --env ../../.env.txt \
  --report ../../TSOutputs/vendor_samples_report.json \
  --vendor-count 10 \
  --everything \
  --paginate-variants \
  --out-details ../../TSOutputs/products_TOT.json
```

### Testing Strategy

| Layer           | Framework   | Command                             |
| --------------- | ----------- | ----------------------------------- |
| **Backend**     | `node:test` | `node --test --watch`               |
| **Frontend**    | Vitest      | `pnpm --filter @app/web-admin test` |
| **Integration** | Custom      | With ephemeral containers           |
| **Load**        | k6          | `k6 run tests/load/*.js`            |

> **Note**: Jest is **NOT** used in this project.

### Docker Services

| Service        | Port  | Purpose                      |
| -------------- | ----- | ---------------------------- |
| **PostgreSQL** | 65010 | Primary database             |
| **Redis**      | 65011 | Queues, cache, rate limiting |
| **Jaeger UI**  | 65020 | Trace visualization          |
| **Grafana**    | 65024 | Dashboards (prod)            |
| **Loki**       | 65023 | Log aggregation (prod)       |

### Key Environment Variables

See [.env.example](.env.example) for the complete list:

| Variable                | Required | Description                      |
| ----------------------- | -------- | -------------------------------- |
| `SHOPIFY_API_KEY`       | ✓        | Shopify app API key              |
| `SHOPIFY_API_SECRET`    | ✓        | Shopify app secret               |
| `DATABASE_URL`          | ✓        | PostgreSQL connection string     |
| `REDIS_URL`             | ✓        | Redis connection string          |
| `NPM_TASKFORCESH_TOKEN` | ✓        | BullMQ Pro registry token        |
| `ENCRYPTION_KEY_256`    | ✓        | AES-256 key for token encryption |
| `OPENAI_API_KEY`        | ✓        | OpenAI API key for embeddings    |

---

## 9. Documentation Index

> [!IMPORTANT]
> **Source of Truth:** [Plan_de_implementare.md](Plan_de_implementare.md) este documentul master pentru planul de implementare.
> Toate celelalte documente din `Docs/` sunt complementare și fac referință la planul principal.

### 📋 Core Documents

| Document | Description |
|----------| & Fixes.md](Problems%20%26%20Fixes.md) | Schema audit: 34 gaps identified + SQL fixes |

### 🏗️ Architecture & Design

| Document                                                                          | Description                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Database_Schema_Complete.md](Docs/Database_Schema_Complete.md)                   | 53 tables, RLS policies, indexes, partitioning |
| [Strategie_dezvoltare.md](Docs/Strategie_dezvoltare.md)                           | Technical blueprint, streaming pipeline design |
| [Structura_Proiect_Neanelu_Shopify.md](Docs/Structura_Proiect_Neanelu_Shopify.md) | Target monorepo structure (8-level deep)       |

### 🔧 Stack & DevOps

| Document                                                                                              | Description                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Stack Tehnologic Complet pnpm Shopify.md](Docs/Stack%20Tecnologic%20Complet%20pnpm%20Shopify.md)     | Version pins, pnpm strategy, dependency table         |
| [DevOps_Plan_Implementare_Shopify_Enterprise.md](Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md) | DevOps playbook, OpenBAO secrets, bare-metal topology |

### 🖥️ Frontend

| Document                                                                  | Description                            |
| ------------------------------------------------------------------------- | -------------------------------------- |
| [Arhitectura_Frontend_Vite_RR7.md](Docs/Arhitectura_Frontend_Vite_RR7.md) | UI/UX specifications, component states |
| [Frontend_Component_Specs.md](Docs/Frontend_Component_Specs.md)           | Component props, hooks, accessibility  |

### 📖 Operational

| Document                                                    | Description                             |
| ----------------------------------------------------------- | --------------------------------------- |
| [runbooks/README.md](Docs/runbooks/README.md)               | Runbook index for production operations |
| [runbooks/logql-queries.md](Docs/runbooks/logql-queries.md) | LogQL query cookbook for Loki           |

---

## 10. Implementation Roadmap

The project follows a phased approach documented in [Plan_de_implementare.md](Plan_de_implementare.md):

| Phase  | Name             | Duration | Status         | Key Deliverables                             |
| ------ | ---------------- | -------- | -------------- | -------------------------------------------- |
| **F0** | Standards & Prep | Week 0   | ✅ Done        | ESLint, TypeScript, pnpm, Docker base        |
| **F1** | Bootstrapping    | Week 1   | ✅ Done        | Monorepo, Git hooks, CI skeleton             |
| **F2** | Data Layer       | Week 2   | 🔄 In Progress | PostgreSQL schema, RLS, Drizzle migrations   |
| **F3** | Core Backend     | Week 3   | 📋 Planned     | OAuth, Webhooks, Fastify API, Frontend shell |
| **F4** | Async Engine     | Week 4   | 📋 Planned     | BullMQ Pro Groups, rate limiting, fairness   |
| **F5** | Bulk Pipeline    | Week 5-6 | 📋 Planned     | Streaming JSONL, stitching, COPY FROM STDIN  |
| **F6** | AI Integration   | Week 7   | 📋 Planned     | OpenAI Batch, pgvector, semantic search      |
| **F7** | Production       | Week 8   | 📋 Planned     | CI/CD, observability, DR, runbooks           |
| **F8** | Extensions       | Post-MVP | 📋 Optional    | Inventory ledger, advanced features          |

### Database Schema Summary

| Module             | Tables               | Purpose                        |
| ------------------ | -------------------- | ------------------------------ |
| A: System Core     | 3                    | Multi-tenancy, auth, sessions  |
| B: Shopify Mirror  | 8                    | Shopify data sync              |
| C: Bulk Operations | 6                    | Bulk import staging            |
| D: Global PIM      | 12                   | Product information management |
| E: Normalization   | 4                    | Attributes, embeddings         |
| F: AI Batch        | 2                    | AI processing jobs             |
| G: Queue           | 2                    | Job tracking                   |
| H: Audit           | 2                    | Observability                  |
| I: Inventory       | 3                    | High-velocity inventory        |
| J: Media           | 5                    | Shopify media, channels        |
| K: Menus           | 2                    | Navigation structures          |
| L: Scraper         | 3                    | Web scraping management        |
| M: Analytics       | 2                    | Precomputed metrics            |
| **Total**          | **53 tables + 1 MV** |                                |

---

## 11. Contributing

### Code Quality Standards

- All code must pass `pnpm lint` and `pnpm typecheck`
- Pre-commit hooks enforce formatting (Prettier) and linting (ESLint)
- Backend tests use `node:test`, frontend uses Vitest

### Commit Convention

```text
[type]([scope]): [description] [optional body] [optional footer]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Pull Request Process

1. Create feature branch from `main`
2. Ensure CI passes (lint, typecheck, test)
3. Update documentation if needed
4. Request review from maintainers

---

## 12. Security

### ⚠️ Critical Guidelines

1. **Never commit secrets**: \`.env\` files with real values are gitignored
2. **Use \`.env.example\`**: Template with placeholders for onboarding
3. **Large artifacts**: JSONL exports are gitignored (too large + potentially sensitive)
4. **Push protection**: GitHub may block pushes if secrets are detected in history

### Secret Management

| Environment      | Method                                      |
| ---------------- | ------------------------------------------- |
| **Development**  | Local \`.env.local\` (not committed)        |
| **Staging/Prod** | OpenBAO (self-hosted Vault) + Agent sidecar |

### Token Rotation Schedule

| Secret Type         | Rotation Period | Notes                              |
| ------------------- | --------------- | ---------------------------------- |
| Shopify tokens      | Quarterly       | Tracked in \`key_rotations\` table |
| BullMQ Pro license  | Quarterly       |                                    |
| OpenAI API key      | Quarterly       |                                    |
| AES encryption keys | Quarterly       | With backward compatibility        |

### Reporting Vulnerabilities

Please report security issues via private disclosure to the maintainers.

---

## Built with ❤️ for Shopify Enterprise Scale

[Documentation](Docs/) • [Implementation Plan](Plan_de_implementare.md) • [Report Issues](https://github.com/your-org/Neanelu_Shopify/issues)
