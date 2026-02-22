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
  // In staging/prod we run behind PgBouncer; keep app pool small to avoid double pooling.
  if (nodeEnv === 'production' || nodeEnv === 'staging') return 3;
  return 10;
}

// ============================================
// CONFIGURARE POOL
// ============================================

/**
 * Pool configuration from environment variables
 * DATABASE_URL format: postgresql://user:password@host:port/database
 */
const poolConfig: pg.PoolConfig = {
  connectionString: process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'],
  max: Number(process.env['DB_POOL_SIZE'] ?? getDefaultPoolSize(process.env['NODE_ENV'])),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Recomandare: statement_timeout pentru queries lungi
  // Se poate adăuga ca parametru în connection string sau aici
};

const dbSslMode = parseDbSslMode(process.env['DB_SSL_MODE']);
if (dbSslMode === 'require') {
  // Internal gateways often terminate/forward TLS without a public CA chain.
  poolConfig.ssl = { rejectUnauthorized: false };
} else if (dbSslMode === 'verify-full') {
  poolConfig.ssl = { rejectUnauthorized: true };
}

/**
 * Shared pg Pool instance
 * Exportat pentru:
 * - pg-copy-streams (COPY FROM STDIN pentru bulk ingest)
 * - Direct queries când Drizzle nu e suficient
 */
export const pool = new Pool(poolConfig);

// ============================================
// DRIZZLE CLIENT
// ============================================

/**
 * Drizzle ORM client
 * Type-safe queries pentru toate operațiunile standard
 */
export const db: NodePgDatabase = drizzle(pool);

// ============================================
// HEALTH CHECK
// ============================================

interface HealthCheckRow {
  health: number;
}

/**
 * Verifică conectivitatea la baza de date
 * Folosit de health endpoints și startup checks
 */
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

/**
 * Închide toate conexiunile din pool
 * Apelat la shutdown pentru cleanup curat
 */
export async function closePool(): Promise<void> {
  await pool.end();
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
  // Cast este ::uuid (tipul standard PostgreSQL), NU ::UUIDv7
  await client.query(`SELECT set_config('app.current_shop_id', $1::text, true)`, [shopId]);
}

/**
 * Execută o funcție în contextul unui tenant specific
 * Wrapper convenabil pentru operațiuni cu RLS
 *
 * @example
 * ```ts
 * const products = await withTenantContext(shopId, async (client) => {
 *   return client.query('SELECT * FROM products');
 * });
 * ```
 */
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

/**
 * Helper pentru a executa o funcție cu RLS activ folosind Drizzle-style
 * Acceptă un callback care primește clientul pg.
 */
export async function withShopContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withTenantContext(shopId, fn);
}
