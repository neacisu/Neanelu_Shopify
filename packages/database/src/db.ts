/**
 * Database Connection - Drizzle ORM + pg Pool
 *
 * CONFORM Stack Tehnologic (secțiunea 4.1) și Plan_de_implementare F2.1.1:
 * - Driver: pg (node-postgres) - NECESAR pentru pg-copy-streams
 * - ORM: Drizzle ORM - type-safe queries
 * - Un singur pool partajat pentru ORM și streaming COPY
 *
 * Pool sizing (bare metal, 10 worker containers):
 * - DB_POOL_SIZE=5 în staging/prod (default 10 pentru dev)
 * - Total conexiuni ≈ (replicas_api + 10 workers) × DB_POOL_SIZE + overhead
 *
 * Hot-reload: exporturile `pool` și `db` sunt Proxy-uri JavaScript care
 * deleghează către instanța activă. La rotația credențialelor, pool-ul vechi
 * este drenat graceful (30s) iar unul nou preia toate conexiunile noi.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

function parseDbSslMode(value: string | undefined): 'disable' | 'require' | 'verify-full' {
  const raw = (value ?? 'disable').trim().toLowerCase();
  if (raw === 'disable' || raw === 'require' || raw === 'verify-full') return raw;
  throw new Error(`Invalid DB_SSL_MODE: ${String(value)} (expected disable|require|verify-full)`);
}

function getDefaultPoolSize(nodeEnv: string | undefined): number {
  if (nodeEnv === 'production' || nodeEnv === 'staging') return 3;
  return 10;
}

// ============================================
// POOL CONFIG (read once, reused on rotation)
// ============================================

const poolConfig: pg.PoolConfig = {
  connectionString: process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'],
  max: Number(process.env['DB_POOL_SIZE'] ?? getDefaultPoolSize(process.env['NODE_ENV'])),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

const dbSslMode = parseDbSslMode(process.env['DB_SSL_MODE']);
if (dbSslMode === 'require') {
  poolConfig.ssl = { rejectUnauthorized: false };
} else if (dbSslMode === 'verify-full') {
  poolConfig.ssl = { rejectUnauthorized: true };
}

// ============================================
// POOL MANAGER (hot-swap via Proxy)
// ============================================

function attachPoolErrorHandler(p: pg.Pool): void {
  p.on('error', (err) => {
    console.error('[DB] Idle client error (non-fatal, pool continues):', err.message);
  });
}

let _pool = new Pool(poolConfig);
attachPoolErrorHandler(_pool);

let _db: NodePgDatabase = drizzle(_pool);
let _currentConnectionString = poolConfig.connectionString;

let _drainTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Proxy transparent — consumatorii (68+ fișiere) văd același `pool`.
 * Toate apelurile (connect, query, on, end, etc.) sunt delegate la _pool curent.
 */
export const pool: pg.Pool = new Proxy(Object.create(null) as pg.Pool, {
  get(_, prop) {
    const target = _pool;
    const value = Reflect.get(target, prop, target) as unknown;
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});

/**
 * Proxy transparent pentru Drizzle ORM.
 */
export const db: NodePgDatabase = new Proxy(Object.create(null) as NodePgDatabase, {
  get(_, prop) {
    const target = _db;
    const value = Reflect.get(target, prop, target) as unknown;
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});

const DRAIN_TIMEOUT_MS = 30_000;

/**
 * Rotește pool-ul DB cu o nouă connection string.
 * 1. Creează pool nou + health check
 * 2. Swap atomic (JS single-threaded)
 * 3. Drain graceful al pool-ului vechi (30s)
 */
export async function rotatePool(newConnectionString: string): Promise<void> {
  const newPoolConfig: pg.PoolConfig = { ...poolConfig, connectionString: newConnectionString };
  const newPool = new Pool(newPoolConfig);
  attachPoolErrorHandler(newPool);

  const client = await newPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  const oldPool = _pool;

  _pool = newPool;
  _db = drizzle(newPool);
  _currentConnectionString = newConnectionString;

  if (_drainTimer) {
    clearTimeout(_drainTimer);
    _drainTimer = null;
  }

  _drainTimer = setTimeout(() => {
    _drainTimer = null;
    oldPool.end().catch((err: unknown) => {
      console.error('[DB] Error draining old pool:', err);
    });
  }, DRAIN_TIMEOUT_MS);
}

/**
 * Returns the current DATABASE_URL (connection string) used by the active pool.
 * Used by credential watcher to detect actual changes.
 */
export function getCurrentConnectionString(): string | undefined {
  return _currentConnectionString;
}

// ============================================
// HEALTH CHECK
// ============================================

interface HealthCheckRow {
  health: number;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<HealthCheckRow>('SELECT 1 as health');
      return result.rows[0]?.health === 1;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[DB] Health check failed:', error);
    return false;
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

export async function closePool(): Promise<void> {
  if (_drainTimer) {
    clearTimeout(_drainTimer);
    _drainTimer = null;
  }
  await _pool.end();
}

// ============================================
// RLS CONTEXT HELPER
// ============================================

/**
 * Setează contextul tenant (shop_id) pentru RLS
 * TREBUIE apelat în cadrul unei tranzacții cu SET LOCAL
 *
 * @example
 * ```ts
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *   await setTenantContext(client, shopId);
 *   // ... queries with RLS active ...
 *   await client.query('COMMIT');
 * } finally {
 *   client.release();
 * }
 * ```
 */
export async function setTenantContext(client: pg.PoolClient, shopId: string): Promise<void> {
  await client.query(`SELECT set_config('app.current_shop_id', $1::text, true)`, [shopId]);
}

export async function withTenantContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, shopId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withShopContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withTenantContext(shopId, fn);
}
