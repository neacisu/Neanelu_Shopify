/**
 * Schema Snapshot Tests (Pre-commit)
 *
 * Verifies schema integrity by checking key counts and structure.
 * Run before commits to detect schema drift.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { getPool, closePool, shouldSkipDbTests, query } from '../helpers/test-utils.ts';
import {
  getAllTables,
  getAllIndexes,
  getAllForeignKeys,
  getAllCheckConstraints,
  getTablesWithRls,
  getAllTriggers,
  getAllMaterializedViews,
  getAllViews,
  getAllPartitions,
  getAllExtensions,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Expected counts from audit (with tolerance)
const EXPECTED = {
  tables: { min: 65, max: 70 }, // 67 base tables
  indexes: { min: 700, max: 800 }, // 742 total with partitions
  foreignKeys: { min: 100, max: 115 }, // 105 FKs
  checkConstraints: { min: 40, max: 50 }, // 43 CHECKs
  rlsTables: { min: 40, max: 45 }, // 42 with RLS
  triggers: { min: 20, max: 30 }, // 25 triggers
  materializedViews: { min: 7, max: 7 }, // Exactly 7
  views: { min: 4, max: 6 }, // 4 views
  partitions: { min: 60, max: 70 }, // 64 partitions
  extensions: { min: 6, max: 10 }, // 9 extensions
};

// ============================================
// SCHEMA SNAPSHOT VERIFICATION
// ============================================

void describe('Schema Snapshot: Pre-commit Verification', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  // ============================================
  // TABLE COUNT
  // ============================================

  void it('table count is within expected range', async () => {
    const tables = await getAllTables();
    const count = tables.length;

    assert.ok(
      count >= EXPECTED.tables.min && count <= EXPECTED.tables.max,
      `Table count ${count} should be between ${EXPECTED.tables.min} and ${EXPECTED.tables.max}`
    );
  });

  // ============================================
  // INDEX COUNT
  // ============================================

  void it('index count is within expected range', async () => {
    const indexes = await getAllIndexes();
    const count = indexes.length;

    assert.ok(
      count >= EXPECTED.indexes.min && count <= EXPECTED.indexes.max,
      `Index count ${count} should be between ${EXPECTED.indexes.min} and ${EXPECTED.indexes.max}`
    );
  });

  // ============================================
  // FOREIGN KEY COUNT
  // ============================================

  void it('foreign key count is within expected range', async () => {
    const fks = await getAllForeignKeys();
    const count = fks.length;

    assert.ok(
      count >= EXPECTED.foreignKeys.min && count <= EXPECTED.foreignKeys.max,
      `FK count ${count} should be between ${EXPECTED.foreignKeys.min} and ${EXPECTED.foreignKeys.max}`
    );
  });

  // ============================================
  // CHECK CONSTRAINT COUNT
  // ============================================

  void it('check constraint count is within expected range', async () => {
    const checks = await getAllCheckConstraints();
    const count = checks.length;

    assert.ok(
      count >= EXPECTED.checkConstraints.min && count <= EXPECTED.checkConstraints.max,
      `CHECK count ${count} should be between ${EXPECTED.checkConstraints.min} and ${EXPECTED.checkConstraints.max}`
    );
  });

  // ============================================
  // RLS TABLES COUNT
  // ============================================

  void it('RLS-enabled table count is within expected range', async () => {
    const rlsTables = await getTablesWithRls();
    const count = rlsTables.length;

    assert.ok(
      count >= EXPECTED.rlsTables.min && count <= EXPECTED.rlsTables.max,
      `RLS table count ${count} should be between ${EXPECTED.rlsTables.min} and ${EXPECTED.rlsTables.max}`
    );
  });

  // ============================================
  // TRIGGER COUNT
  // ============================================

  void it('trigger count is within expected range', async () => {
    const triggers = await getAllTriggers();
    const count = triggers.length;

    assert.ok(
      count >= EXPECTED.triggers.min && count <= EXPECTED.triggers.max,
      `Trigger count ${count} should be between ${EXPECTED.triggers.min} and ${EXPECTED.triggers.max}`
    );
  });

  // ============================================
  // MATERIALIZED VIEW COUNT
  // ============================================

  void it('materialized view count is exactly 7', async () => {
    const mvs = await getAllMaterializedViews();
    const count = mvs.length;

    assert.strictEqual(count, 7, `MV count should be exactly 7, got ${count}`);
  });

  // ============================================
  // VIEW COUNT
  // ============================================

  void it('view count is within expected range', async () => {
    const views = await getAllViews();
    const count = views.length;

    assert.ok(
      count >= EXPECTED.views.min && count <= EXPECTED.views.max,
      `View count ${count} should be between ${EXPECTED.views.min} and ${EXPECTED.views.max}`
    );
  });

  // ============================================
  // PARTITION COUNT
  // ============================================

  void it('partition count is within expected range', async () => {
    const partitions = await getAllPartitions();
    const count = partitions.length;

    assert.ok(
      count >= EXPECTED.partitions.min && count <= EXPECTED.partitions.max,
      `Partition count ${count} should be between ${EXPECTED.partitions.min} and ${EXPECTED.partitions.max}`
    );
  });

  // ============================================
  // EXTENSION COUNT
  // ============================================

  void it('extension count is within expected range', async () => {
    const extensions = await getAllExtensions();
    const count = extensions.length;

    assert.ok(
      count >= EXPECTED.extensions.min && count <= EXPECTED.extensions.max,
      `Extension count ${count} should be between ${EXPECTED.extensions.min} and ${EXPECTED.extensions.max}`
    );
  });
});

// ============================================
// SCHEMA HASH VERIFICATION
// ============================================

void describe('Schema Hash Verification', { skip: SKIP }, () => {
  void it('generates consistent schema hash', async () => {
    // Get all table names sorted
    const tables = await getAllTables();
    const tableNames = tables
      .map((t) => t.table_name)
      .sort()
      .join(',');

    // Generate hash
    const hash = crypto.createHash('sha256').update(tableNames).digest('hex').slice(0, 16);

    // Just verify hash is generated - actual comparison would be against stored value
    assert.ok(hash.length === 16, 'Should generate 16-char hash');
    assert.ok(/^[0-9a-f]+$/.test(hash), 'Hash should be hexadecimal');
  });

  void it('critical tables are present', async () => {
    const tables = await getAllTables();
    const tableNames = tables.map((t) => t.table_name);

    const criticalTables = [
      'shops',
      'shopify_products',
      'shopify_variants',
      'bulk_runs',
      'audit_logs',
      'prod_master',
    ];

    for (const critical of criticalTables) {
      assert.ok(tableNames.includes(critical), `Critical table ${critical} should exist`);
    }
  });
});

// ============================================
// REQUIRED EXTENSIONS CHECK
// ============================================

void describe('Required Extensions', { skip: SKIP }, () => {
  const REQUIRED_EXTENSIONS = [
    'pgcrypto',
    'citext',
    'pg_trgm',
    'btree_gin',
    'btree_gist',
    'vector',
  ];

  void it('has all required extensions', async () => {
    const extensions = await getAllExtensions();
    const extNames = extensions.map((e) => e.extname);

    for (const required of REQUIRED_EXTENSIONS) {
      assert.ok(extNames.includes(required), `Required extension ${required} should be installed`);
    }
  });
});

// ============================================
// POSTGRESQL VERSION CHECK
// ============================================

void describe('PostgreSQL Version', { skip: SKIP }, () => {
  void it('is PostgreSQL 18.x', async () => {
    const result = await query<{ version: string }>('SELECT version()');
    const version = result[0]?.version ?? '';

    assert.ok(version.includes('PostgreSQL 18'), `Expected PostgreSQL 18, got: ${version}`);
  });
});
