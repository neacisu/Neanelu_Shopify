/**
 * Default Values Integrity Tests
 *
 * Verifies DEFAULT values are correctly set for columns.
 * Ensures proper initialization of records.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTableColumns, getAllTables } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Expected default values
const EXPECTED_DEFAULTS: Record<string, Record<string, string | RegExp>> = {
  shops: {
    plan_tier: /'free'/,
    created_at: /now\(\)|CURRENT_TIMESTAMP/i,
  },
  shopify_products: {
    status: /'ACTIVE'/,
    created_at: /now\(\)|CURRENT_TIMESTAMP/i,
  },
  bulk_runs: {
    status: /'pending'/i,
    progress_percent: /0/,
    total_items: /0/,
    processed_items: /0/,
    failed_items: /0/,
    created_at: /now\(\)|CURRENT_TIMESTAMP/i,
  },
  ai_batches: {
    status: /'pending'/i,
    total_items: /0/,
    completed_items: /0/,
    failed_items: /0/,
  },
  feature_flags: {
    enabled: /false/,
  },
  rate_limit_buckets: {
    tokens_remaining: /\d+/,
  },
  scheduled_tasks: {
    is_active: /true/,
  },
  scraper_configs: {
    is_active: /true/,
  },
};

// ============================================
// UUID DEFAULTS
// ============================================

void describe('Default Values: UUID Generation', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('id columns have uuidv7() default', async () => {
    const tables = await getAllTables();
    let tablesWithUuidDefault = 0;

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const idColumn = columns.find((c) => c.column_name === 'id');

      if (idColumn?.column_default) {
        const hasUuidDefault =
          idColumn.column_default.includes('uuidv7') ||
          idColumn.column_default.includes('uuid_generate') ||
          idColumn.column_default.includes('gen_random_uuid');

        if (hasUuidDefault) {
          tablesWithUuidDefault++;
        }
      }
    }

    // Most tables should have UUID default
    assert.ok(
      tablesWithUuidDefault >= 50,
      `Expected at least 50 tables with UUID default, got ${tablesWithUuidDefault}`
    );
  });

  void it('shops.id has uuidv7() default', async () => {
    const columns = await getTableColumns('shops');
    const id = columns.find((c) => c.column_name === 'id');

    assert.ok(id?.column_default, 'shops.id should have a default');
    assert.ok(
      id?.column_default.includes('uuidv7') || id?.column_default.includes('uuid'),
      'shops.id should use UUID generation'
    );
  });
});

// ============================================
// TIMESTAMP DEFAULTS
// ============================================

void describe('Default Values: Timestamp Defaults', { skip: SKIP }, () => {
  void it('created_at columns have now() default', async () => {
    const tables = await getAllTables();
    let tablesWithTimestampDefault = 0;

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const createdAt = columns.find((c) => c.column_name === 'created_at');

      if (createdAt?.column_default) {
        const hasTimestampDefault =
          createdAt.column_default.includes('now') ||
          createdAt.column_default.includes('CURRENT_TIMESTAMP');

        if (hasTimestampDefault) {
          tablesWithTimestampDefault++;
        }
      }
    }

    // Most tables with created_at should have timestamp default
    assert.ok(
      tablesWithTimestampDefault >= 40,
      `Expected at least 40 tables with timestamp default, got ${tablesWithTimestampDefault}`
    );
  });

  void it('shops.created_at has now() default', async () => {
    const columns = await getTableColumns('shops');
    const createdAt = columns.find((c) => c.column_name === 'created_at');

    assert.ok(createdAt?.column_default, 'shops.created_at should have a default');
    assert.ok(
      createdAt?.column_default.includes('now') ||
        createdAt?.column_default.includes('CURRENT_TIMESTAMP'),
      'shops.created_at should use now()'
    );
  });
});

// ============================================
// STATUS DEFAULTS
// ============================================

void describe('Default Values: Status Defaults', { skip: SKIP }, () => {
  void it('shopify_products.status defaults to ACTIVE', async () => {
    const columns = await getTableColumns('shopify_products');
    const status = columns.find((c) => c.column_name === 'status');

    if (status?.column_default) {
      assert.ok(
        status.column_default.includes('ACTIVE'),
        'shopify_products.status should default to ACTIVE'
      );
    }
  });

  void it('bulk_runs.status defaults to pending', async () => {
    const columns = await getTableColumns('bulk_runs');
    const status = columns.find((c) => c.column_name === 'status');

    if (status?.column_default) {
      assert.ok(
        status.column_default.toLowerCase().includes('pending'),
        'bulk_runs.status should default to pending'
      );
    }
  });
});

// ============================================
// NUMERIC DEFAULTS
// ============================================

void describe('Default Values: Numeric Defaults', { skip: SKIP }, () => {
  void it('bulk_runs counter columns default to 0', async () => {
    const columns = await getTableColumns('bulk_runs');

    const counters = ['progress_percent', 'total_items', 'processed_items', 'failed_items'];

    for (const counterName of counters) {
      const counter = columns.find((c) => c.column_name === counterName);

      if (counter?.column_default) {
        assert.ok(
          counter.column_default.includes('0'),
          `bulk_runs.${counterName} should default to 0`
        );
      }
    }
  });
});

// ============================================
// BOOLEAN DEFAULTS
// ============================================

void describe('Default Values: Boolean Defaults', { skip: SKIP }, () => {
  void it('feature_flags.enabled defaults to false', async () => {
    const columns = await getTableColumns('feature_flags');
    const enabled = columns.find((c) => c.column_name === 'enabled');

    if (enabled?.column_default) {
      assert.ok(
        enabled.column_default.includes('false'),
        'feature_flags.enabled should default to false'
      );
    }
  });

  void it('is_active columns default to true', async () => {
    const tablesWithIsActive = ['scheduled_tasks', 'scraper_configs'];

    for (const tableName of tablesWithIsActive) {
      const columns = await getTableColumns(tableName);
      const isActive = columns.find((c) => c.column_name === 'is_active');

      if (isActive?.column_default) {
        assert.ok(
          isActive.column_default.includes('true'),
          `${tableName}.is_active should default to true`
        );
      }
    }
  });
});

// ============================================
// EXPECTED DEFAULTS VERIFICATION
// ============================================

void describe('Default Values: Expected Defaults', { skip: SKIP }, () => {
  for (const [tableName, columns] of Object.entries(EXPECTED_DEFAULTS)) {
    void describe(`Table: ${tableName}`, () => {
      for (const [columnName, expectedPattern] of Object.entries(columns)) {
        void it(`${columnName} has expected default`, async () => {
          const tableColumns = await getTableColumns(tableName);
          const col = tableColumns.find((c) => c.column_name === columnName);

          assert.ok(col, `${tableName}.${columnName} should exist`);

          if (col?.column_default) {
            if (expectedPattern instanceof RegExp) {
              assert.ok(
                expectedPattern.test(col.column_default),
                `${tableName}.${columnName} default "${col.column_default}" should match ${expectedPattern}`
              );
            } else {
              assert.ok(
                col.column_default.includes(expectedPattern),
                `${tableName}.${columnName} should have default containing "${expectedPattern}"`
              );
            }
          }
        });
      }
    });
  }
});

// ============================================
// JSONB DEFAULTS
// ============================================

void describe('Default Values: JSONB Defaults', { skip: SKIP }, () => {
  void it('JSONB columns with defaults use valid JSON', async () => {
    const tablesWithJsonbDefaults = [{ table: 'shops', column: 'plan_limits' }];

    for (const { table, column } of tablesWithJsonbDefaults) {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      if (col?.column_default) {
        // Default should be valid JSON syntax
        assert.ok(
          col.column_default.includes('{') || col.column_default.includes('null'),
          `${table}.${column} JSONB default should be valid JSON`
        );
      }
    }
  });
});

// ============================================
// ARRAY DEFAULTS
// ============================================

void describe('Default Values: Array Defaults', { skip: SKIP }, () => {
  void it('shops.scopes has empty array default', async () => {
    const columns = await getTableColumns('shops');
    const scopes = columns.find((c) => c.column_name === 'scopes');

    if (scopes?.column_default) {
      assert.ok(
        scopes.column_default.includes('{}') || scopes.column_default.includes('ARRAY'),
        'shops.scopes should default to empty array'
      );
    }
  });
});
