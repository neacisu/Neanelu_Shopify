import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('../../database/drizzle/migrations', import.meta.url))
);

async function runSqlFile(pool, fileName) {
  const sql = await readFile(join(MIGRATIONS_DIR, fileName), 'utf8');
  await pool.query(sql);
}

async function runAllMigrations(pool) {
  const fileNames = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const fileName of fileNames) {
    await runSqlFile(pool, fileName);
  }
}

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
    // pgvector image includes `vector`; migrations also rely on pgcrypto + pg_trgm.
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

    await runAllMigrations(pool);

    const env = {
      ...process.env,
      DATABASE_URL: connectionString,
      // Opt-in flag used by integration suites in `src/__tests__/*`.
      PIM_TESTS_WITH_DB: '1',
    };

    const exitCode = await run('pnpm', ['test'], env);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await pool?.end().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    const elapsedMs = Date.now() - startedAt;
    console.info(`[pim:test:db] done in ${elapsedMs}ms`);
  }
}

await main();
