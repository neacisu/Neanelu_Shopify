import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const startedAt = Date.now();
  let container;
  let pool;

  try {
    // Keep aligned with migrations requirements: vector, pgcrypto, pg_trgm.
    container = await new PostgreSqlContainer('pgvector/pgvector:0.8.1-pg18-trixie').start();
    const connectionString = container.getConnectionUri();

    pool = new Pool({ connectionString });
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query(
      `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
       SELECT gen_random_uuid();
       $$ LANGUAGE SQL;`
    );
    // Apply migrations ONCE, deterministically, before running tests.
    // This avoids node:test file concurrency races where integrity/constraints suites run
    // before schema bootstrap suites have called `migrate()`.
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(__dirname, '../drizzle/migrations');
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });

    const env = {
      ...process.env,
      DATABASE_URL_TEST: connectionString,
    };

    const exitCode = await run('pnpm', ['test'], env);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await pool?.end().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    const elapsedMs = Date.now() - startedAt;
    console.info(`[database:test:db] done in ${elapsedMs}ms`);
  }
}

await main();
