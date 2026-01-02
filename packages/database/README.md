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

`pnpm db:migrate` uses a migration runner that acquires a PostgreSQL advisory lock (`pg_advisory_lock`) to prevent concurrent migration runs.

## Environment

- `DATABASE_URL_MIGRATE`: preferred connection string for migrations (DDL-capable role).
- `DATABASE_URL`: runtime connection string (least privilege role).
- `DB_POOL_SIZE`: runtime pool size.
- `DB_POOL_SIZE_MIGRATE`: migration pool size (recommended 1).

## Bootstrap roles

Role creation and passwords are handled outside of migrations (superuser required):

- `scripts/db-bootstrap.sh`
