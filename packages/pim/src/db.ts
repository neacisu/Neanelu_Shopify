import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function parseDbSslMode(value: string | undefined): 'disable' | 'require' | 'verify-full' {
  const raw = (value ?? 'disable').trim().toLowerCase();
  if (raw === 'disable' || raw === 'require' || raw === 'verify-full') return raw;
  throw new Error(`Invalid DB_SSL_MODE: ${String(value)} (expected disable|require|verify-full)`);
}

export function getDbPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env['DATABASE_URL'] ?? '';
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL');
  }
  const cfg: pg.PoolConfig = {
    connectionString,
    max: Number(process.env['DB_POOL_SIZE'] ?? 2),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
  const dbSslMode = parseDbSslMode(process.env['DB_SSL_MODE']);
  if (dbSslMode === 'require') cfg.ssl = { rejectUnauthorized: false };
  else if (dbSslMode === 'verify-full') cfg.ssl = { rejectUnauthorized: true };

  pool = new Pool(cfg);
  return pool;
}
