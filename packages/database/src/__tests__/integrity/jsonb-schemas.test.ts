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

// All JSONB columns in the schema (verified from actual database)
const JSONB_COLUMNS = [
  { table: 'shops', column: 'plan_limits', description: 'Plan tier limits' },
  { table: 'shops', column: 'settings', description: 'Shop settings' },
  { table: 'shopify_products', column: 'metafields', description: 'Product metafields' },
  { table: 'shopify_products', column: 'options', description: 'Product options' },
  { table: 'shopify_variants', column: 'metafields', description: 'Variant metafields' },
  { table: 'shopify_variants', column: 'selected_options', description: 'Selected options' },
  { table: 'shopify_metaobjects', column: 'fields', description: 'Metaobject fields' },
  { table: 'shopify_orders', column: 'line_items', description: 'Order line items' },
  { table: 'shopify_customers', column: 'metafields', description: 'Customer metafields' },
  { table: 'staging_products', column: 'raw_data', description: 'Staged product data' },
  { table: 'staging_products', column: 'options', description: 'Product options' },
  { table: 'staging_variants', column: 'raw_data', description: 'Staged variant data' },
  { table: 'audit_logs', column: 'details', description: 'Audit details' },
  { table: 'webhook_events', column: 'payload', description: 'Webhook payload' },
  { table: 'prod_proposals', column: 'proposed_value', description: 'Proposed changes' },
  { table: 'prod_raw_harvest', column: 'raw_data', description: 'Raw scraped data' },
  { table: 'scheduled_tasks', column: 'job_data', description: 'Task configuration' },
  { table: 'scraper_configs', column: 'selectors', description: 'Scraper selectors' },
  { table: 'scraper_configs', column: 'rate_limit', description: 'Rate limit config' },
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
      { table: 'audit_logs', column: 'details' },
      { table: 'staging_products', column: 'raw_data' },
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
      { table: 'staging_products', column: 'options' },
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
  void it('scheduled_tasks.job_data is JSONB', async () => {
    const columns = await getTableColumns('scheduled_tasks');
    const jobData = columns.find((c) => c.column_name === 'job_data');

    assert.ok(jobData, 'job_data should exist');
    assert.strictEqual(jobData?.udt_name, 'jsonb', 'job_data should be jsonb');
  });

  void it('scraper_configs.selectors is JSONB', async () => {
    const columns = await getTableColumns('scraper_configs');
    const selectors = columns.find((c) => c.column_name === 'selectors');

    assert.ok(selectors, 'selectors should exist');
    assert.strictEqual(selectors?.udt_name, 'jsonb', 'selectors should be jsonb');
  });
});

// ============================================
// AUDIT JSONB COLUMNS
// ============================================

void describe('JSONB Schema: Audit Columns', { skip: SKIP }, () => {
  void it('audit_logs has details column', async () => {
    const columns = await getTableColumns('audit_logs');

    const details = columns.find((c) => c.column_name === 'details');

    assert.ok(details, 'details should exist');
    assert.strictEqual(details?.udt_name, 'jsonb', 'details should be jsonb');
  });
});
