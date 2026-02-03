import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDbPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_MIGRATE'] ?? '';
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL');
  }
  pool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}
