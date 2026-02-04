/**
 * Database Migration Runner (locked)
 *
 * CONFORM: Plan_de_implementare.md F2.2.3.1
 * - forward-only migrations (no down migrations)
 * - advisory lock to prevent concurrent migration runners
 * - uses SQL migrations from ./drizzle/migrations
 */

import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const { Pool } = pg;

const MIGRATION_LOCK_ID = 12345;

async function run(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env['DB_POOL_SIZE'] ?? 1),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle/migrations');

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch {
      // Best-effort unlock; connection close will release session locks.
    }
    client.release();
    await pool.end();
  }
}

void run().catch((err) => {
  console.error('[db:migrate] failed:', err);
  process.exit(1);
});
