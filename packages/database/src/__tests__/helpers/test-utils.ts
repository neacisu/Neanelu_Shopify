/**
 * Test Utilities for Database Schema Tests
 *
 * Provides common setup/teardown, connection pool management,
 * tenant context helpers, and test fixtures.
 */

import pg from 'pg';

// ============================================
// CONNECTION POOL
// ============================================

let _pool: pg.Pool | null = null;

/**
 * Get or create a shared connection pool for tests
 */
export function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return _pool;
}

/**
 * Close the shared pool (call in after())
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Check if database tests should be skipped
 */
export function shouldSkipDbTests(): boolean {
  return !process.env['DATABASE_URL'];
}

// ============================================
// TENANT CONTEXT (RLS)
// ============================================

/**
 * Set tenant context for RLS testing
 * Must be called within a transaction (BEGIN)
 */
export async function setTenantContext(client: pg.PoolClient, shopId: string): Promise<void> {
  await client.query(`SELECT set_config('app.current_shop_id', $1::text, true)`, [shopId]);
}

/**
 * Clear tenant context
 */
export async function clearTenantContext(client: pg.PoolClient): Promise<void> {
  await client.query(`SELECT set_config('app.current_shop_id', '', true)`);
}

/**
 * Execute a function with tenant context set
 */
export async function withTenantContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
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

// ============================================
// TEST FIXTURES
// ============================================

/**
 * Standard test UUIDs for tenant isolation tests
 */
export const TEST_SHOP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const TEST_SHOP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const TEST_SHOP_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/**
 * Test shop data for creating test records
 */
export interface TestShopData {
  id: string;
  shopify_domain: string;
}

export const TEST_SHOPS: TestShopData[] = [
  { id: TEST_SHOP_A, shopify_domain: 'shop-a.myshopify.com' },
  { id: TEST_SHOP_B, shopify_domain: 'shop-b.myshopify.com' },
  { id: TEST_SHOP_C, shopify_domain: 'shop-c.myshopify.com' },
];

/**
 * Create test shops if they don't exist
 */
export async function createTestShops(client: pg.PoolClient): Promise<void> {
  for (const shop of TEST_SHOPS) {
    await client.query(
      `INSERT INTO shops (id, shopify_domain, access_token_ciphertext, access_token_iv, access_token_tag, scopes)
       VALUES ($1, $2, '\\x00', '\\x00', '\\x00', '{}')
       ON CONFLICT (shopify_domain) DO NOTHING`,
      [shop.id, shop.shopify_domain]
    );
  }
}

/**
 * Delete test shops and related data
 */
export async function cleanupTestShops(client: pg.PoolClient): Promise<void> {
  const shopIds = TEST_SHOPS.map((s) => s.id);
  // Delete in reverse dependency order
  await client.query('DELETE FROM shopify_products WHERE shop_id = ANY($1)', [shopIds]);
  await client.query('DELETE FROM shops WHERE id = ANY($1)', [shopIds]);
}

// ============================================
// QUERY HELPERS
// ============================================

/**
 * Query result row type constraint
 */
type QueryResultRow = Record<string, unknown>;

/**
 * Execute a query and return typed results
 */
export async function query<T extends QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return first row or null
 */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Check if a table exists
 */
export async function tableExists(tableName: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    ) as exists`,
    [tableName]
  );
  return result?.exists ?? false;
}

/**
 * Check if an index exists
 */
export async function indexExists(indexName: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname = $1
    ) as exists`,
    [indexName]
  );
  return result?.exists ?? false;
}

/**
 * Check if a function exists
 */
export async function functionExists(functionName: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name = $1
    ) as exists`,
    [functionName]
  );
  return result?.exists ?? false;
}

/**
 * Check if a constraint exists
 */
export async function constraintExists(constraintName: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM pg_constraint 
      WHERE conname = $1
    ) as exists`,
    [constraintName]
  );
  return result?.exists ?? false;
}

// ============================================
// ASSERTION HELPERS
// ============================================

/**
 * Format assertion error message
 */
export function formatError(expected: unknown, actual: unknown, context?: string): string {
  const ctx = context ? ` (${context})` : '';
  return `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${ctx}`;
}

/**
 * Deep compare arrays regardless of order
 */
export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}
