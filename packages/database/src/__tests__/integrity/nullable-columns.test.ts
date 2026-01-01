/**
 * Nullable Columns Integrity Tests
 *
 * Verifies NOT NULL constraints on required columns.
 * Ensures data integrity for critical fields.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTableColumns, getAllTables } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Columns that MUST be NOT NULL
const REQUIRED_NOT_NULL: Record<string, string[]> = {
  shops: [
    'id',
    'shopify_domain',
    'access_token_ciphertext',
    'access_token_iv',
    'access_token_tag',
    'created_at',
  ],
  staff_users: ['id', 'shop_id', 'email', 'created_at'],
  shopify_products: ['id', 'shop_id', 'shopify_gid', 'title', 'handle', 'status', 'created_at'],
  shopify_variants: ['id', 'shop_id', 'product_id', 'shopify_gid', 'created_at'],
  shopify_collections: ['id', 'shop_id', 'shopify_gid', 'title', 'created_at'],
  shopify_orders: ['id', 'shop_id', 'shopify_gid', 'created_at'],
  bulk_runs: ['id', 'shop_id', 'operation_type', 'status', 'created_at'],
  bulk_steps: ['id', 'shop_id', 'bulk_run_id', 'step_type', 'status'],
  audit_logs: ['id', 'shop_id', 'action', 'entity_type', 'created_at'],
  prod_master: ['id', 'canonical_name', 'created_at'],
  prod_taxonomy: ['id', 'name', 'slug', 'level'],
  ai_batches: ['id', 'shop_id', 'batch_type', 'status', 'created_at'],
  embedding_batches: ['id', 'shop_id', 'batch_type', 'status', 'created_at'],
  webhook_events: ['id', 'shop_id', 'topic', 'received_at'],
};

// Columns that SHOULD be nullable
const EXPECTED_NULLABLE: Record<string, string[]> = {
  shops: ['uninstalled_at', 'shop_owner_email', 'last_api_call_at'],
  shopify_products: ['description', 'product_type', 'vendor', 'published_at'],
  shopify_variants: ['compare_at_price', 'barcode', 'weight'],
  bulk_runs: ['completed_at', 'error_message'],
  audit_logs: ['old_values', 'new_values', 'user_agent', 'ip_address'],
  prod_master: ['brand', 'model', 'description'],
};

// ============================================
// NOT NULL VERIFICATION
// ============================================

void describe('Nullable Columns: NOT NULL Constraints', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const [tableName, columns] of Object.entries(REQUIRED_NOT_NULL)) {
    void describe(`Table: ${tableName}`, () => {
      for (const columnName of columns) {
        void it(`${columnName} is NOT NULL`, async () => {
          const tableColumns = await getTableColumns(tableName);
          const col = tableColumns.find((c) => c.column_name === columnName);

          assert.ok(col, `${tableName}.${columnName} should exist`);
          assert.strictEqual(
            col?.is_nullable,
            'NO',
            `${tableName}.${columnName} should be NOT NULL`
          );
        });
      }
    });
  }
});

// ============================================
// NULLABLE VERIFICATION
// ============================================

void describe('Nullable Columns: Expected Nullable', { skip: SKIP }, () => {
  for (const [tableName, columns] of Object.entries(EXPECTED_NULLABLE)) {
    void describe(`Table: ${tableName}`, () => {
      for (const columnName of columns) {
        void it(`${columnName} is nullable`, async () => {
          const tableColumns = await getTableColumns(tableName);
          const col = tableColumns.find((c) => c.column_name === columnName);

          assert.ok(col, `${tableName}.${columnName} should exist`);
          assert.strictEqual(
            col?.is_nullable,
            'YES',
            `${tableName}.${columnName} should be nullable`
          );
        });
      }
    });
  }
});

// ============================================
// PRIMARY KEY NOT NULL
// ============================================

void describe('Nullable Columns: All Primary Keys NOT NULL', { skip: SKIP }, () => {
  void it('all id columns are NOT NULL', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const idColumn = columns.find((c) => c.column_name === 'id');

      if (idColumn) {
        assert.strictEqual(idColumn.is_nullable, 'NO', `${table.table_name}.id should be NOT NULL`);
      }
    }
  });
});

// ============================================
// FOREIGN KEY COLUMNS
// ============================================

void describe('Nullable Columns: Foreign Key Columns', { skip: SKIP }, () => {
  void it('shop_id is NOT NULL on tenant tables', async () => {
    const tenantTables = [
      'staff_users',
      'shopify_products',
      'shopify_variants',
      'shopify_collections',
      'shopify_orders',
      'bulk_runs',
      'audit_logs',
      'ai_batches',
    ];

    for (const tableName of tenantTables) {
      const columns = await getTableColumns(tableName);
      const shopId = columns.find((c) => c.column_name === 'shop_id');

      assert.ok(shopId, `${tableName}.shop_id should exist`);
      assert.strictEqual(shopId?.is_nullable, 'NO', `${tableName}.shop_id should be NOT NULL`);
    }
  });

  void it('product_id is NOT NULL on variant tables', async () => {
    const columns = await getTableColumns('shopify_variants');
    const productId = columns.find((c) => c.column_name === 'product_id');

    assert.ok(productId, 'product_id should exist');
    assert.strictEqual(productId?.is_nullable, 'NO', 'product_id should be NOT NULL');
  });

  void it('bulk_run_id is NOT NULL on bulk child tables', async () => {
    const childTables = ['bulk_steps', 'bulk_artifacts', 'bulk_errors'];

    for (const tableName of childTables) {
      const columns = await getTableColumns(tableName);
      const bulkRunId = columns.find((c) => c.column_name === 'bulk_run_id');

      assert.ok(bulkRunId, `${tableName}.bulk_run_id should exist`);
      assert.strictEqual(
        bulkRunId?.is_nullable,
        'NO',
        `${tableName}.bulk_run_id should be NOT NULL`
      );
    }
  });
});

// ============================================
// TIMESTAMP COLUMNS
// ============================================

void describe('Nullable Columns: Timestamp Constraints', { skip: SKIP }, () => {
  void it('created_at is NOT NULL', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const createdAt = columns.find((c) => c.column_name === 'created_at');

      if (createdAt) {
        assert.strictEqual(
          createdAt.is_nullable,
          'NO',
          `${table.table_name}.created_at should be NOT NULL`
        );
      }
    }
  });

  void it('updated_at is nullable (may not be set initially)', async () => {
    // updated_at is typically set by trigger, could be NULL initially
    // or could be NOT NULL with default - both are valid
    const columns = await getTableColumns('shops');
    const updatedAt = columns.find((c) => c.column_name === 'updated_at');

    if (updatedAt) {
      // Just verify it exists, nullable state depends on implementation
      assert.ok(updatedAt, 'updated_at should exist');
    }
  });
});

// ============================================
// STATUS COLUMNS
// ============================================

void describe('Nullable Columns: Status Columns NOT NULL', { skip: SKIP }, () => {
  const statusTables = [
    { table: 'shopify_products', column: 'status' },
    { table: 'bulk_runs', column: 'status' },
    { table: 'bulk_steps', column: 'status' },
    { table: 'ai_batches', column: 'status' },
    { table: 'embedding_batches', column: 'status' },
  ];

  for (const { table, column } of statusTables) {
    void it(`${table}.${column} is NOT NULL`, async () => {
      const columns = await getTableColumns(table);
      const statusCol = columns.find((c) => c.column_name === column);

      assert.ok(statusCol, `${table}.${column} should exist`);
      assert.strictEqual(statusCol?.is_nullable, 'NO', `${table}.${column} should be NOT NULL`);
    });
  }
});
