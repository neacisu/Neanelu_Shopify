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

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;

type ParsedDbConnection = Readonly<{
  connectionString: string | undefined;
  runtimeRole: string | null;
}>;

function normalizeRoleName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!ROLE_NAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function extractRoleFromOptions(optionsRaw: string): {
  sanitizedOptions: string | null;
  runtimeRole: string | null;
} {
  let decoded: string;
  try {
    decoded = decodeURIComponent(optionsRaw).trim();
  } catch {
    decoded = optionsRaw.trim();
  }
  if (!decoded) {
    return { sanitizedOptions: null, runtimeRole: null };
  }

  const tokens = decoded.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let runtimeRole: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    // Forms accepted:
    // -c role=my_role
    // -c role = my_role
    if (token === '-c') {
      const next = tokens[i + 1];
      const next2 = tokens[i + 2];
      const next3 = tokens[i + 3];
      if (typeof next === 'string' && next.toLowerCase() === 'role') {
        if (next2 === '=') {
          runtimeRole = normalizeRoleName(next3) ?? runtimeRole;
          i += 3;
          continue;
        }
      }
      if (typeof next === 'string' && /^role=/i.test(next)) {
        runtimeRole = normalizeRoleName(next.split('=').slice(1).join('=')) ?? runtimeRole;
        i += 1;
        continue;
      }
      kept.push(token);
      continue;
    }

    if (/^role=/i.test(token)) {
      runtimeRole = normalizeRoleName(token.split('=').slice(1).join('=')) ?? runtimeRole;
      continue;
    }

    kept.push(token);
  }

  return {
    sanitizedOptions: kept.length ? encodeURIComponent(kept.join(' ')) : null,
    runtimeRole,
  };
}

function parseConnectionString(rawUrl: string | undefined): ParsedDbConnection {
  if (!rawUrl) {
    return { connectionString: undefined, runtimeRole: null };
  }

  try {
    const url = new URL(rawUrl);
    let runtimeRole: string | null = normalizeRoleName(url.searchParams.get('role'));
    if (url.searchParams.has('role')) {
      url.searchParams.delete('role');
    }

    const optionsParam = url.searchParams.get('options');
    if (optionsParam) {
      const parsedOptions = extractRoleFromOptions(optionsParam);
      runtimeRole = parsedOptions.runtimeRole ?? runtimeRole;
      if (parsedOptions.sanitizedOptions) {
        url.searchParams.set('options', parsedOptions.sanitizedOptions);
      } else {
        url.searchParams.delete('options');
      }
    }

    return { connectionString: url.toString(), runtimeRole };
  } catch {
    return { connectionString: rawUrl, runtimeRole: null };
  }
}

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

const parsedInitialConnection = parseConnectionString(
  process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL']
);

const poolConfig: pg.PoolConfig = {
  connectionString: parsedInitialConnection.connectionString,
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
// AUTH ERROR DETECTION
// ============================================

/**
 * Detectează erori de autentificare PostgreSQL (SQLSTATE 28P01/28000).
 * Folosit pentru a triggera rotația automată a credențialelor.
 */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const pgErr = err as { code?: string };
  if (pgErr.code === '28P01' || pgErr.code === '28000') return true;
  return /password authentication failed/i.test(err.message);
}

// ============================================
// CREDENTIAL REFRESH CALLBACK
// ============================================

type CredentialRefreshFn = () => Promise<boolean>;

let _credentialRefreshFn: CredentialRefreshFn | null = null;

/**
 * Înregistrează callback-ul de refresh al credențialelor.
 * Apelat de credential-watcher.ts la pornire — evită dependență circulară.
 */
export function registerCredentialRefreshFn(fn: CredentialRefreshFn): void {
  _credentialRefreshFn = fn;
}

const AUTH_ERROR_DEBOUNCE_MS = 5_000;
let _lastAuthErrorHandledAt = 0;
let _authErrorRefreshInFlight: Promise<boolean> | null = null;

async function handleAuthError(): Promise<boolean> {
  if (!_credentialRefreshFn) return false;

  const now = Date.now();
  if (now - _lastAuthErrorHandledAt < AUTH_ERROR_DEBOUNCE_MS) {
    if (_authErrorRefreshInFlight) return _authErrorRefreshInFlight;
    return false;
  }
  _lastAuthErrorHandledAt = now;

  try {
    _authErrorRefreshInFlight = _credentialRefreshFn();
    const rotated = await _authErrorRefreshInFlight;
    return rotated;
  } catch (refreshErr) {
    console.error('[DB] Credential refresh failed:', refreshErr);
    return false;
  } finally {
    _authErrorRefreshInFlight = null;
  }
}

// ============================================
// POOL MANAGER (hot-swap via Proxy)
// ============================================

function attachPoolErrorHandler(p: pg.Pool): void {
  p.on('error', (err) => {
    if (isAuthError(err)) {
      console.error('[DB] Auth error on idle client — triggering credential refresh');
      void handleAuthError();
      return;
    }
    console.error('[DB] Idle client error (non-fatal, pool continues):', err.message);
  });
}

const _clientsWithErrorHandler = new WeakSet<pg.PoolClient>();

function attachClientErrorHandler(client: pg.PoolClient, poolLabel: string): pg.PoolClient {
  if (_clientsWithErrorHandler.has(client)) return client;

  client.on('error', (err) => {
    if (isAuthError(err)) {
      console.error(
        `[${poolLabel}] Auth error on checked-out client — triggering credential refresh`
      );
      void handleAuthError();
      return;
    }

    console.error(`[${poolLabel}] Checked-out client error (connection dropped):`, err.message);
  });

  _clientsWithErrorHandler.add(client);
  return client;
}

let _runtimeRole: string | null = parsedInitialConnection.runtimeRole;

async function applyRuntimeRole(client: pg.PoolClient, useLocalRole: boolean): Promise<void> {
  if (!_runtimeRole) return;
  const escapedRole = _runtimeRole.replace(/"/g, '""');
  const sql = `${useLocalRole ? 'SET LOCAL' : 'SET'} ROLE "${escapedRole}"`;
  try {
    await client.query(sql);
  } catch (error) {
    console.warn('[DB] Failed to apply runtime role, continuing without role switch', {
      role: _runtimeRole,
      useLocalRole,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let _pool = new Pool(poolConfig);
attachPoolErrorHandler(_pool);

let _db: NodePgDatabase = drizzle(_pool);
let _currentConnectionString = poolConfig.connectionString;

let _drainTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Proxy transparent — consumatorii (68+ fișiere) văd același `pool`.
 * Interceptează `connect()` și `query()` pentru retry automat pe auth error.
 * Restul apelurilor (on, end, etc.) sunt delegate direct la _pool curent.
 */
export const pool: pg.Pool = new Proxy(Object.create(null) as pg.Pool, {
  get(_, prop) {
    const target = _pool;
    const value = Reflect.get(target, prop, target) as unknown;
    if (typeof value !== 'function') return value;

    const bound = (value as (...args: unknown[]) => unknown).bind(target);

    if (prop === 'connect' || prop === 'query') {
      return async (...args: unknown[]) => {
        try {
          const result = await (bound as (...a: unknown[]) => Promise<unknown>)(...args);
          if (prop === 'connect') {
            return attachClientErrorHandler(result as pg.PoolClient, 'DB');
          }
          return result;
        } catch (err) {
          if (!isAuthError(err)) throw err;
          const rotated = await handleAuthError();
          if (!rotated) throw err;
          const freshTarget = _pool;
          const freshFn = Reflect.get(freshTarget, prop, freshTarget) as (
            ...a: unknown[]
          ) => Promise<unknown>;
          const result = await freshFn.bind(freshTarget)(...args);
          if (prop === 'connect') {
            return attachClientErrorHandler(result as pg.PoolClient, 'DB');
          }
          return result;
        }
      };
    }

    return bound;
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
  const parsed = parseConnectionString(newConnectionString);
  const newPoolConfig: pg.PoolConfig = { ...poolConfig, connectionString: parsed.connectionString };
  const newPool = new Pool(newPoolConfig);
  attachPoolErrorHandler(newPool);

  const client = await newPool.connect();
  try {
    await applyRuntimeRole(client, false);
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  const oldPool = _pool;

  _pool = newPool;
  _db = drizzle(newPool);
  _currentConnectionString = parsed.connectionString;
  _runtimeRole = parsed.runtimeRole;

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

export type SecondaryPoolHandle = Readonly<{
  pool: pg.Pool;
  rotate: (newConnectionString: string) => Promise<void>;
  close: () => Promise<void>;
  getCurrentConnectionString: () => string | undefined;
}>;

export function createSecondaryPool(opts: {
  name: string;
  maxConnections?: number;
  connectionString?: string;
}): SecondaryPoolHandle {
  const initialConnectionString = opts.connectionString ?? process.env['DATABASE_URL'] ?? '';
  if (!initialConnectionString) {
    throw new Error(`[DB:${opts.name}] Missing DATABASE_URL`);
  }

  const initialParsed = parseConnectionString(initialConnectionString);
  const secondaryPoolConfig: pg.PoolConfig = {
    ...poolConfig,
    connectionString: initialParsed.connectionString,
    max: opts.maxConnections ?? Number(process.env['DB_POOL_SIZE'] ?? 2),
  };

  let activePool = new Pool(secondaryPoolConfig);
  attachPoolErrorHandler(activePool);
  let currentConnectionString = initialParsed.connectionString;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;

  const poolProxy: pg.Pool = new Proxy(Object.create(null) as pg.Pool, {
    get(_, prop) {
      const target = activePool;
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);

      if (prop === 'connect' || prop === 'query') {
        return async (...args: unknown[]) => {
          try {
            const result = await (bound as (...a: unknown[]) => Promise<unknown>)(...args);
            if (prop === 'connect') {
              return attachClientErrorHandler(result as pg.PoolClient, `DB:${opts.name}`);
            }
            return result;
          } catch (err) {
            if (!isAuthError(err)) throw err;
            const rotated = await handleAuthError();
            if (!rotated) throw err;
            const freshTarget = activePool;
            const freshFn = Reflect.get(freshTarget, prop, freshTarget) as (
              ...a: unknown[]
            ) => Promise<unknown>;
            const result = await freshFn.bind(freshTarget)(...args);
            if (prop === 'connect') {
              return attachClientErrorHandler(result as pg.PoolClient, `DB:${opts.name}`);
            }
            return result;
          }
        };
      }

      return bound;
    },
  });

  const rotate = async (newConnectionString: string): Promise<void> => {
    const parsed = parseConnectionString(newConnectionString);
    const nextPoolConfig: pg.PoolConfig = {
      ...secondaryPoolConfig,
      connectionString: parsed.connectionString,
    };
    const nextPool = new Pool(nextPoolConfig);
    attachPoolErrorHandler(nextPool);

    const client = await nextPool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    const oldPool = activePool;
    activePool = nextPool;
    currentConnectionString = parsed.connectionString;

    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }

    drainTimer = setTimeout(() => {
      drainTimer = null;
      oldPool.end().catch((err: unknown) => {
        console.error(`[DB:${opts.name}] Error draining old secondary pool:`, err);
      });
    }, DRAIN_TIMEOUT_MS);
  };

  const close = async (): Promise<void> => {
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    await activePool.end();
  };

  // Avoid static import cycle (db.ts <-> credential-watcher.ts).
  void import('./credential-watcher.js')
    .then((mod: { registerSecondaryPoolRotator: (fn: (url: string) => Promise<void>) => void }) => {
      mod.registerSecondaryPoolRotator(async (newUrl: string) => {
        if (newUrl === currentConnectionString) return;
        await rotate(newUrl);
      });
    })
    .catch((err: unknown) => {
      console.error(`[DB:${opts.name}] Failed to register secondary pool rotator:`, err);
    });

  return {
    pool: poolProxy,
    rotate,
    close,
    getCurrentConnectionString: () => currentConnectionString,
  };
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

async function _withTenantContextCore<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyRuntimeRole(client, true);
    await setTenantContext(client, shopId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* drain may fail on dead conn */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withTenantContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  try {
    return await _withTenantContextCore(shopId, fn);
  } catch (error) {
    if (!isAuthError(error)) throw error;
    const rotated = await handleAuthError();
    if (!rotated) throw error;
    return await _withTenantContextCore(shopId, fn);
  }
}

export async function withShopContext<T>(
  shopId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withTenantContext(shopId, fn);
}
