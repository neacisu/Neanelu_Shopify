import { spawn } from 'node:child_process';
import pg from 'pg';

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function canConnect(connectionString) {
  // Best-effort preflight: avoid failing locally just because .env points to a dev DB
  // that isn't running. In CI we want a hard failure.
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 500,
    connectionTimeoutMillis: 1200,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const dbUrlRaw =
    (process.env.DATABASE_URL_TEST && process.env.DATABASE_URL_TEST.trim()) ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) ||
    '';
  const hasDbUrl = Boolean(dbUrlRaw);
  const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const useContainers = process.env.DATABASE_TESTS_WITH_CONTAINERS === '1';

  if (!hasDbUrl) {
    if (isCi && useContainers) {
      const code = await run('pnpm', ['run', 'test:db'], process.env);
      process.exitCode = code;
      return;
    }

    // Local dev default: don't fail the entire monorepo test run when DB isn't running.
    if (!isCi) {
      console.info('[database:test] skipping (DATABASE_URL_TEST/DATABASE_URL not set)');
      return;
    }

    throw new Error(
      'Database tests require DATABASE_URL_TEST/DATABASE_URL or DATABASE_TESTS_WITH_CONTAINERS=1 in CI'
    );
  }

  // If a DB URL exists but is not reachable, prefer testcontainers locally (Plan FAZA G).
  // This avoids requiring a dev DB on localhost:65010 just to run unit/integration tests.
  if (!(await canConnect(dbUrlRaw))) {
    if (isCi) {
      throw new Error('[database:test] DATABASE_URL_TEST/DATABASE_URL is set but not reachable');
    }
    console.info(
      '[database:test] database unreachable; falling back to testcontainers (pnpm run test:db)'
    );
    const code = await run('pnpm', ['run', 'test:db'], {
      ...process.env,
      DATABASE_TESTS_WITH_CONTAINERS: '1',
    });
    process.exitCode = code;
    return;
  }

  const code = await run(
    'node',
    ['--test', '--experimental-test-isolation=none', 'src/**/*.test.ts'],
    process.env
  );
  process.exitCode = code;
}

await main();
