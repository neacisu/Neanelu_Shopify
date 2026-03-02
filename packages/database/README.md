# @app/database

## Scope

This package owns the PostgreSQL schema, migrations, and DB utilities.

## Migrations

- Source of truth: SQL migrations in `drizzle/migrations/`.
- Strategy: forward-only. Rollbacks are handled via compensating migrations.

### Running migrations

- Local dev: run migrations against your local Postgres.
  - `pnpm db:migrate`
- CI: `pnpm db:migrate` should run against ephemeral Postgres.
- Staging/Prod: run migrations as a dedicated step/job before deploying app containers.

### Concurrency safety

`pnpm db:migrate` uses a migration runner that acquires a transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock`) to prevent concurrent migration runs.

### Ownership invariant (critical)

- Migrations must run under role `neanelu_app` (stable owner role).
- The runner enforces this invariant and fails fast when ownership drift is detected on `public` tables/partitions/sequences.
- If drift is detected, reconcile ownership on CT107 first:
  - `sudo bash infra/scripts/ct107_reconcile_neanelu_ownership.sh --mode dry-run`
  - `sudo bash infra/scripts/ct107_reconcile_neanelu_ownership.sh --mode apply`

## Environment

- `DATABASE_URL`: single connection string (owner) used for runtime and migrations.
- `DB_POOL_SIZE`: pool size.

## Bootstrap roles

Role creation and passwords are handled outside of migrations (superuser required):

- `scripts/db-bootstrap.sh`
