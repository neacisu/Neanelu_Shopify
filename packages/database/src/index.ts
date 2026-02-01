/**
 * @app/database - Database Package Entry Point
 *
 * Exports pentru utilizare în apps/backend-worker și alte packages:
 * - db: Drizzle ORM client pentru type-safe queries
 * - pool: pg Pool pentru pg-copy-streams și queries directe
 * - Helpers pentru RLS tenant context
 * - Health check utilities
 * - Encryption utilities
 */

// ============================================
// CORE EXPORTS
// ============================================

export {
  db,
  pool,
  checkDatabaseConnection,
  closePool,
  setTenantContext,
  withTenantContext,
} from './db.js';

export { logAuditEvent } from './audit.js';
export type { AuditAction, AuditActorType, AuditContext } from './audit.js';

// ============================================
// ENCRYPTION EXPORTS
// ============================================

export { encryptAesGcm, decryptAesGcm, randomIv } from './encryption/crypto.js';
export type { EncryptResult } from './encryption/crypto.js';

// ============================================
// AUTH EXPORTS
// ============================================

export {
  exchangeCodeForToken,
  encryptShopifyAccessToken,
  upsertOfflineShopCredentials,
} from './auth/shopify-oauth.js';
export type { ShopifyTokenExchangeResult } from './auth/shopify-oauth.js';

// ============================================
// TYPES RE-EXPORTS
// ============================================

// Re-export pg types pentru consumers care au nevoie
export type { Pool, PoolClient, QueryResult } from 'pg';

// ============================================
// STREAMING EXPORTS (COPY)
// ============================================

export { PgCopyStreamsManager } from './streaming/pg-copy-streams.manager.js';

// Drizzle types vor fi exportate când avem schema
// export * from './schema/index.js';

// ============================================
// PGVECTOR TUNING EXPORTS
// ============================================

export {
  getOptimalEfSearch,
  setHnswEfSearch,
  withOptimizedSearch,
  HNSW_EF_CONSTRUCTION,
  HNSW_M,
} from './tuning/pgvector.js';
