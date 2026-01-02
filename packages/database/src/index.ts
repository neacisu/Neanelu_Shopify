/**
 * @app/database - Database Package Entry Point
 *
 * Exports pentru utilizare în apps/backend-worker și alte packages:
 * - db: Drizzle ORM client pentru type-safe queries
 * - pool: pg Pool pentru pg-copy-streams și queries directe
 * - Helpers pentru RLS tenant context
 * - Health check utilities
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
// TYPES RE-EXPORTS
// ============================================

// Re-export pg types pentru consumers care au nevoie
export type { Pool, PoolClient, QueryResult } from 'pg';

// Drizzle types vor fi exportate când avem schema
// export * from './schema/index.js';
