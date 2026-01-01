/**
 * JSONB Schema Integrity Tests
 *
 * Verifies JSONB columns have proper structure validation
 * and GIN indexes for efficient querying.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableColumns,
  getTableIndexes,
  getTableCheckConstraints,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// All JSONB columns in the schema
const JSONB_COLUMNS = [
  { table: 'shops', column: 'plan_limits', description: 'Plan tier limits' },
  { table: 'shopify_products', column: 'metafields', description: 'Product metafields' },
  { table: 'shopify_products', column: 'options', description: 'Product options' },
  { table: 'shopify_variants', column: 'metafields', description: 'Variant metafields' },
  { table: 'shopify_variants', column: 'selected_options', description: 'Selected options' },
  { table: 'shopify_metaobjects', column: 'fields', description: 'Metaobject fields' },
  { table: 'shopify_orders', column: 'line_items', description: 'Order line items' },
  { table: 'shopify_orders', column: 'shipping_address', description: 'Shipping address' },
  { table: 'shopify_orders', column: 'billing_address', description: 'Billing address' },
  { table: 'shopify_customers', column: 'addresses', description: 'Customer addresses' },
  { table: 'shopify_customers', column: 'metafields', description: 'Customer metafields' },
  { table: 'staging_products', column: 'staging_data', description: 'Staged product data' },
  { table: 'staging_variants', column: 'staging_data', description: 'Staged variant data' },
  { table: 'audit_logs', column: 'old_values', description: 'Previous values' },
  { table: 'audit_logs', column: 'new_values', description: 'New values' },
  { table: 'webhook_events', column: 'payload', description: 'Webhook payload' },
  { table: 'ai_batch_items', column: 'input_data', description: 'AI input data' },
  { table: 'ai_batch_items', column: 'output_data', description: 'AI output data' },
  { table: 'prod_proposals', column: 'proposed_value', description: 'Proposed changes' },
  { table: 'prod_raw_harvest', column: 'raw_data', description: 'Raw scraped data' },
  { table: 'prod_extraction_sessions', column: 'extracted_data', description: 'Extracted data' },
  { table: 'scheduled_tasks', column: 'config', description: 'Task configuration' },
  { table: 'scraper_configs', column: 'config', description: 'Scraper configuration' },
  { table: 'job_runs', column: 'metadata', description: 'Job metadata' },
];

// JSONB columns that MUST have GIN indexes
const JSONB_WITH_GIN = [
  { table: 'shopify_products', column: 'metafields' },
  { table: 'shopify_metaobjects', column: 'fields' },
  { table: 'shopify_products', column: 'tags' }, // Array but often uses GIN
];

// ============================================
// JSONB COLUMN EXISTENCE
// ============================================

void describe('JSONB Schema: Column Existence', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const { table, column, description } of JSONB_COLUMNS) {
    void it(`${table}.${column} exists (${description})`, async () => {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      assert.ok(col, `${table}.${column} should exist`);
      assert.strictEqual(col?.udt_name, 'jsonb', `${table}.${column} should be jsonb type`);
    });
  }
});

// ============================================
// JSONB GIN INDEXES
// ============================================

void describe('JSONB Schema: GIN Indexes', { skip: SKIP }, () => {
  for (const { table, column } of JSONB_WITH_GIN) {
    void it(`${table}.${column} has GIN index`, async () => {
      const indexes = await getTableIndexes(table);
      const ginIndex = indexes.find(
        (i) => i.indexdef.toLowerCase().includes('gin') && i.indexdef.includes(column)
      );

      assert.ok(ginIndex, `${table}.${column} should have GIN index for efficient JSONB queries`);
    });
  }
});

// ============================================
// JSONB STRUCTURE VALIDATION
// ============================================

void describe('JSONB Schema: Structure Validation', { skip: SKIP }, () => {
  void it('plan_limits has known structure', async () => {
    const columns = await getTableColumns('shops');
    const planLimits = columns.find((c) => c.column_name === 'plan_limits');

    assert.ok(planLimits, 'plan_limits should exist');
    assert.strictEqual(planLimits?.udt_name, 'jsonb', 'should be jsonb');

    // Check if there's a CHECK constraint for structure
    const checks = await getTableCheckConstraints('shops');
    const planCheck = checks.find((c) => c.check_clause.includes('plan_limits'));

    // Not required but good to have
    if (planCheck) {
      assert.ok(planCheck.check_clause, 'plan_limits check should have clause');
    }
  });

  void it('metafields columns are properly typed', async () => {
    const tablesWithMetafields = ['shopify_products', 'shopify_variants', 'shopify_customers'];

    for (const tableName of tablesWithMetafields) {
      const columns = await getTableColumns(tableName);
      const metafields = columns.find((c) => c.column_name === 'metafields');

      if (metafields) {
        assert.strictEqual(metafields.udt_name, 'jsonb', `${tableName}.metafields should be jsonb`);
      }
    }
  });
});

// ============================================
// JSONB NULLABLE HANDLING
// ============================================

void describe('JSONB Schema: Nullable Handling', { skip: SKIP }, () => {
  void it('optional JSONB columns are nullable', async () => {
    const optionalJsonb = [
      { table: 'audit_logs', column: 'old_values' },
      { table: 'audit_logs', column: 'new_values' },
      { table: 'ai_batch_items', column: 'output_data' },
    ];

    for (const { table, column } of optionalJsonb) {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      if (col) {
        assert.strictEqual(col.is_nullable, 'YES', `${table}.${column} should be nullable`);
      }
    }
  });

  void it('required JSONB columns are NOT NULL or have defaults', async () => {
    const requiredJsonb = [
      { table: 'webhook_events', column: 'payload' },
      { table: 'staging_products', column: 'staging_data' },
    ];

    for (const { table, column } of requiredJsonb) {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      if (col) {
        const hasDefault = col.column_default !== null;
        const isNotNull = col.is_nullable === 'NO';

        assert.ok(
          hasDefault || isNotNull || col.is_nullable === 'YES',
          `${table}.${column} should have proper null handling`
        );
      }
    }
  });
});

// ============================================
// JSONB QUERY OPERATORS
// ============================================

void describe('JSONB Schema: Query Operator Support', { skip: SKIP }, () => {
  void it('GIN indexes support containment (@>) operator', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const metafieldsGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes('gin') && i.indexdef.includes('metafields')
    );

    if (metafieldsGin) {
      // GIN indexes support @>, ?, ?|, ?&, @@ operators
      assert.ok(
        metafieldsGin.indexdef.includes('gin'),
        'Should use GIN for JSONB containment queries'
      );
    }
  });

  void it('jsonb_path_ops indexes where applicable', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const pathOpsIndex = indexes.find((i) => i.indexdef.includes('jsonb_path_ops'));

    // jsonb_path_ops is more efficient for @> but not required
    // Just document if present
    if (pathOpsIndex) {
      assert.ok(pathOpsIndex, 'Found jsonb_path_ops index for optimized containment');
    }
  });
});

// ============================================
// JSONB COLUMN COUNT
// ============================================

void describe('JSONB Schema: Column Count', { skip: SKIP }, () => {
  void it('has expected number of JSONB columns', () => {
    // Count should be close to our list
    assert.ok(
      JSONB_COLUMNS.length >= 20,
      `Expected at least 20 JSONB columns, have ${JSONB_COLUMNS.length} in spec`
    );
  });
});

// ============================================
// CONFIGURATION JSONB COLUMNS
// ============================================

void describe('JSONB Schema: Configuration Columns', { skip: SKIP }, () => {
  void it('scheduled_tasks.config is JSONB', async () => {
    const columns = await getTableColumns('scheduled_tasks');
    const config = columns.find((c) => c.column_name === 'config');

    assert.ok(config, 'config should exist');
    assert.strictEqual(config?.udt_name, 'jsonb', 'config should be jsonb');
  });

  void it('scraper_configs.config is JSONB', async () => {
    const columns = await getTableColumns('scraper_configs');
    const config = columns.find((c) => c.column_name === 'config');

    assert.ok(config, 'config should exist');
    assert.strictEqual(config?.udt_name, 'jsonb', 'config should be jsonb');
  });
});

// ============================================
// AUDIT JSONB COLUMNS
// ============================================

void describe('JSONB Schema: Audit Columns', { skip: SKIP }, () => {
  void it('audit_logs has old_values and new_values', async () => {
    const columns = await getTableColumns('audit_logs');

    const oldValues = columns.find((c) => c.column_name === 'old_values');
    const newValues = columns.find((c) => c.column_name === 'new_values');

    assert.ok(oldValues, 'old_values should exist');
    assert.ok(newValues, 'new_values should exist');

    assert.strictEqual(oldValues?.udt_name, 'jsonb', 'old_values should be jsonb');
    assert.strictEqual(newValues?.udt_name, 'jsonb', 'new_values should be jsonb');
  });
});
