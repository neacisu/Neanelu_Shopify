/**
 * Database Migration Runner (locked)
 *
 * CONFORM: Plan_de_implementare.md F2.2.3.1
 * - forward-only migrations (no down migrations)
 * - advisory lock to prevent concurrent migration runners
 * - uses SQL migrations from ./drizzle/migrations
 *
 * Uses 'public' schema for migration tracking to avoid permission issues
 * with OpenBao dynamic credentials that don't have access to the 'drizzle' schema.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const { Pool } = pg;

const MIGRATION_LOCK_ID = 12345;
const MIGRATIONS_SCHEMA = 'public';
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * One-time bootstrap: if switching from 'drizzle' schema to 'public' schema,
 * pre-populate the tracking table with hashes of all existing migration SQL files
 * so Drizzle doesn't try to re-apply them.
 */
async function bootstrapMigrationTracking(
  client: pg.PoolClient,
  migrationsFolder: string
): Promise<void> {
  const tableExists = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    [MIGRATIONS_SCHEMA, MIGRATIONS_TABLE]
  );

  if (tableExists.rows.length > 0) return;

  console.info('[db:migrate] bootstrapping migration tracking in public schema');

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) return;

  interface JournalEntry {
    tag: string;
    when: number;
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as { entries?: JournalEntry[] };
  const entries: JournalEntry[] = journal.entries ?? [];

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  try {
    await client.query(
      `GRANT ALL ON TABLE ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} TO neanelu_app`
    );
    await client.query(
      `GRANT USAGE, SELECT ON SEQUENCE ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}_id_seq TO neanelu_app`
    );
  } catch {
    // Dynamic user may not own the table; safe to ignore.
  }

  for (const entry of entries) {
    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) continue;

    const sqlContent = fs.readFileSync(sqlFile, 'utf-8');
    const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

    await client.query(
      `INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at)
       SELECT $1, $2 WHERE NOT EXISTS (
         SELECT 1 FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} WHERE hash = $1
       )`,
      [hash, entry.when]
    );
  }

  console.info(`[db:migrate] bootstrapped ${entries.length} migration records`);
}

async function run(): Promise<void> {
  const databaseUrl = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL');
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

    await bootstrapMigrationTracking(client, migrationsFolder);

    const db = drizzle(client);
    await migrate(db, { migrationsFolder, migrationsSchema: MIGRATIONS_SCHEMA });
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
