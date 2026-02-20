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
const FQN = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;

/**
 * Ensure the tracking table is accessible. With OpenBao dynamic credentials,
 * the table may exist but be owned by a revoked user (reassigned to postgres).
 * Strategy:
 *   1. If the table doesn't exist → do nothing (bootstrap will create it)
 *   2. If it exists and is accessible → done
 *   3. If it exists but inaccessible → try SET ROLE neanelu_app
 *   4. If still inaccessible → try DROP + recreate
 */
async function ensureTrackingTableAccess(client: pg.PoolClient): Promise<void> {
  const exists = await client.query(
    `SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
    [MIGRATIONS_SCHEMA, MIGRATIONS_TABLE]
  );

  if (!exists.rows.length) return;

  try {
    await client.query(`SELECT 1 FROM ${FQN} LIMIT 0`);
    return;
  } catch {
    console.info('[db:migrate] tracking table exists but is inaccessible');
  }

  try {
    await client.query('SET ROLE neanelu_app');
    await client.query(`SELECT 1 FROM ${FQN} LIMIT 0`);
    console.info('[db:migrate] accessible via SET ROLE neanelu_app');
    return;
  } catch {
    try {
      await client.query('RESET ROLE');
    } catch {
      /* ignore */
    }
  }

  console.info('[db:migrate] dropping inaccessible tracking table to recreate');
  try {
    await client.query(`DROP TABLE IF EXISTS ${FQN} CASCADE`);
  } catch {
    console.info('[db:migrate] cannot drop tracking table — manual intervention needed');
    throw new Error(
      `Cannot access or drop ${FQN}. Run as superuser: ALTER TABLE ${FQN} OWNER TO neanelu_app;`
    );
  }
}

/**
 * One-time bootstrap: pre-populate the tracking table with hashes of all
 * existing migration SQL files so Drizzle doesn't try to re-apply them.
 */
async function bootstrapMigrationTracking(
  client: pg.PoolClient,
  migrationsFolder: string
): Promise<void> {
  const tableExists = await client.query(
    `SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
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
    CREATE TABLE IF NOT EXISTS ${FQN} (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const entry of entries) {
    const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) continue;

    const sqlContent = fs.readFileSync(sqlFile, 'utf-8');
    const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

    await client.query(
      `INSERT INTO ${FQN} (hash, created_at)
       SELECT $1, $2 WHERE NOT EXISTS (
         SELECT 1 FROM ${FQN} WHERE hash = $1
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

    await ensureTrackingTableAccess(client);
    await bootstrapMigrationTracking(client, migrationsFolder);

    const db = drizzle(client);
    await migrate(db, { migrationsFolder, migrationsSchema: MIGRATIONS_SCHEMA });
  } finally {
    try {
      await client.query('RESET ROLE');
    } catch {
      /* best-effort */
    }
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch {
      /* best-effort */
    }
    client.release();
    await pool.end();
  }
}

void run().catch((err) => {
  console.error('[db:migrate] failed:', err);
  process.exit(1);
});
