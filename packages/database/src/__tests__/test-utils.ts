/**
 * Test Utilities (Plan FAZA G.1)
 *
 * This file exists at the exact path referenced by the migration plan.
 * It re-exports the existing helpers and adds a deterministic Testcontainers
 * bootstrap for DB tests when DATABASE_URL_TEST/DATABASE_URL are missing.
 *
 * Opt-in:
 *   DATABASE_TESTS_WITH_CONTAINERS=1
 */

import pg from 'pg';

export * from './helpers/test-utils.ts';

let _containerStop: (() => Promise<void>) | null = null;
let _pool: pg.Pool | null = null;

export function shouldUseTestcontainers(): boolean {
  return process.env['DATABASE_TESTS_WITH_CONTAINERS'] === '1';
}

export function getEnvDatabaseUrl(): string | null {
  const url = process.env['DATABASE_URL_TEST']?.trim() ?? process.env['DATABASE_URL']?.trim() ?? '';
  return url.length ? url : null;
}

export async function ensureTestDatabaseUrl(): Promise<string> {
  const existing = getEnvDatabaseUrl();
  if (existing) return existing;

  if (!shouldUseTestcontainers()) {
    throw new Error(
      'Missing DATABASE_URL_TEST/DATABASE_URL. Set DATABASE_TESTS_WITH_CONTAINERS=1 to auto-start Postgres.'
    );
  }

  // Dynamic import so default unit test runs don't require Docker.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const container = await new PostgreSqlContainer('pgvector/pgvector:0.8.1-pg18-trixie').start();
  const connectionString = container.getConnectionUri();

  // Ensure cleanup even if tests crash.
  _containerStop = async () => {
    await container.stop();
  };
  process.once('exit', () => {
    void _containerStop?.().catch(() => undefined);
  });

  const pool = new pg.Pool({ connectionString });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query(
      `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
       SELECT gen_random_uuid();
       $$ LANGUAGE SQL;`
    );

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(__dirname, '../drizzle/migrations');
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end().catch(() => undefined);
  }

  process.env['DATABASE_URL_TEST'] = connectionString;
  return connectionString;
}

export async function getTestPool(): Promise<pg.Pool> {
  if (_pool) return _pool;
  const url = await ensureTestDatabaseUrl();
  _pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return _pool;
}

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  if (_containerStop) {
    await _containerStop().catch(() => undefined);
    _containerStop = null;
  }
}
