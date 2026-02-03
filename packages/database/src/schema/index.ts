/**
 * Database Schema - Entry Point
 *
 * CONFORM: Database_Schema_Complete.md v2.6
 * PR-008: F2.2.1 - Core Schema (shops, products, bulk_runs)
 * PR-010: F2.2.5-F2.2.7 - PIM Schema + pgvector Embeddings
 *
 * Exporturi organizate pe module:
 * - Module A: System Core (shops, staff_users, app_sessions)
 * - Module B: Shopify Mirror (shopify_products, shopify_variants)
 * - Module C: Bulk Operations (bulk_runs, bulk_steps)
 * - Module D: Global PIM (prod_taxonomy, prod_master, etc.)
 * - Module E: Attribute Normalization & Vectors
 */

// ============================================
// Module A: System Core & Multi-tenancy
// ============================================
export * from './shops.ts';
export * from './staff-users.ts';
export * from './shop-ai-credentials.ts';

// ============================================
// Module H: Audit & Observability
// ============================================
export * from './audit.ts';
export * from './api-usage.ts';

// ============================================
// Module B: Shopify Mirror
// ============================================
export * from './shopify-products.ts';
export * from './shopify-tokens.ts';

// ============================================
// Module C: Bulk Operations
// ============================================
export * from './bulk-operations.ts';
export * from './bulk-schedules.ts';

// ============================================
// Module D: Global PIM
// ============================================
export * from './pim.ts';
export * from './pim-similarity.ts';

// ============================================
// Module E: Attribute Normalization & Vectors
// ============================================
export * from './vectors.ts';
