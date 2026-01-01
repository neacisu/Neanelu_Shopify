/**
 * Module C: Bulk Operations Schema Tests
 *
 * Tests for 6 bulk operation tables:
 * - bulk_runs
 * - bulk_steps
 * - bulk_artifacts
 * - bulk_errors
 * - staging_products
 * - staging_variants
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  getTableConstraints,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// BULK_RUNS TABLE
// ============================================

void describe('Module C: bulk_runs table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('bulk_runs');
    assert.ok(info, 'bulk_runs table should exist');
  });

  void it('has all required columns with correct types', async () => {
    const columns = await getTableColumns('bulk_runs');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    // Primary key
    assert.ok(columnMap.has('id'), 'should have id');
    assert.strictEqual(columnMap.get('id')?.udt_name, 'uuid', 'id should be uuid');

    // Shop reference
    assert.ok(columnMap.has('shop_id'), 'should have shop_id');

    // Bulk operation data
    assert.ok(columnMap.has('operation_type'), 'should have operation_type');
    assert.ok(columnMap.has('query_type'), 'should have query_type');
    assert.ok(columnMap.has('status'), 'should have status');
    assert.ok(columnMap.has('shopify_operation_id'), 'should have shopify_operation_id');
    assert.ok(columnMap.has('polling_url'), 'should have polling_url');
    assert.ok(columnMap.has('result_url'), 'should have result_url');
    assert.ok(columnMap.has('records_processed'), 'should have records_processed');
    assert.ok(columnMap.has('bytes_processed'), 'should have bytes_processed');
    assert.ok(columnMap.has('error_code'), 'should have error_code');
    assert.ok(columnMap.has('error_message'), 'should have error_message');

    // Timestamps
    assert.ok(columnMap.has('started_at'), 'should have started_at');
    assert.ok(columnMap.has('completed_at'), 'should have completed_at');
    assert.ok(columnMap.has('created_at'), 'should have created_at');
    assert.ok(columnMap.has('updated_at'), 'should have updated_at');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('bulk_runs');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(
      indexNames.some((n) => n.includes('pkey')),
      'should have primary key index'
    );
    assert.ok(
      indexNames.includes('idx_bulk_runs_active_shop'),
      'should have active shop unique index'
    );
  });

  void it('has UNIQUE partial index for active bulk per shop', async () => {
    const indexes = await getTableIndexes('bulk_runs');
    const activeIndex = indexes.find((i) => i.indexname === 'idx_bulk_runs_active_shop');
    assert.ok(activeIndex, 'idx_bulk_runs_active_shop should exist');
    assert.ok(activeIndex.indexdef.includes('UNIQUE'), 'should be UNIQUE index');
    assert.ok(activeIndex.indexdef.includes('WHERE'), 'should be partial index');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('bulk_runs');
    assert.strictEqual(hasRls, true, 'bulk_runs should have RLS enabled');
  });

  void it('has CHECK constraint on status', async () => {
    const constraints = await getTableConstraints('bulk_runs');
    const checkConstraint = constraints.find((c) => c.constraint_name === 'chk_bulk_status');
    assert.ok(checkConstraint, 'chk_bulk_status constraint should exist');
  });
});

// ============================================
// BULK_STEPS TABLE
// ============================================

void describe('Module C: bulk_steps table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('bulk_steps');
    assert.ok(info, 'bulk_steps table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('bulk_steps');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('bulk_run_id'), 'should have bulk_run_id');
    assert.ok(columnNames.includes('step_name'), 'should have step_name');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('step_order'), 'should have step_order');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('bulk_steps');
    assert.strictEqual(hasRls, true, 'bulk_steps should have RLS enabled');
  });

  void it('has FK to bulk_runs', async () => {
    const constraints = await getTableConstraints('bulk_steps');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key constraint to bulk_runs');
  });
});

// ============================================
// BULK_ARTIFACTS TABLE
// ============================================

void describe('Module C: bulk_artifacts table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('bulk_artifacts');
    assert.ok(info, 'bulk_artifacts table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('bulk_artifacts');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('bulk_run_id'), 'should have bulk_run_id');
    assert.ok(columnNames.includes('artifact_type'), 'should have artifact_type');
    assert.ok(columnNames.includes('file_path'), 'should have file_path');
    assert.ok(columnNames.includes('url'), 'should have url');
    assert.ok(columnNames.includes('bytes_size'), 'should have bytes_size');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('bulk_artifacts');
    assert.strictEqual(hasRls, true, 'bulk_artifacts should have RLS enabled');
  });
});

// ============================================
// BULK_ERRORS TABLE
// ============================================

void describe('Module C: bulk_errors table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('bulk_errors');
    assert.ok(info, 'bulk_errors table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('bulk_errors');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('bulk_run_id'), 'should have bulk_run_id');
    assert.ok(columnNames.includes('error_type'), 'should have error_type');
    assert.ok(columnNames.includes('error_code'), 'should have error_code');
    assert.ok(columnNames.includes('error_message'), 'should have error_message');
    assert.ok(columnNames.includes('payload'), 'should have payload');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('bulk_errors');
    assert.strictEqual(hasRls, true, 'bulk_errors should have RLS enabled');
  });
});

// ============================================
// STAGING_PRODUCTS TABLE
// ============================================

void describe('Module C: staging_products table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('staging_products');
    assert.ok(info, 'staging_products table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('staging_products');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('bulk_run_id'), 'should have bulk_run_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('raw_data'), 'should have raw_data');
    assert.ok(columnNames.includes('validation_status'), 'should have validation_status');
  });

  void it('has JSONB raw_data column', async () => {
    const columns = await getTableColumns('staging_products');
    const rawData = columns.find((c) => c.column_name === 'raw_data');
    assert.ok(rawData, 'raw_data column should exist');
    assert.strictEqual(rawData?.udt_name, 'jsonb', 'raw_data should be jsonb');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('staging_products');
    assert.strictEqual(hasRls, true, 'staging_products should have RLS enabled');
  });
});

// ============================================
// STAGING_VARIANTS TABLE
// ============================================

void describe('Module C: staging_variants table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('staging_variants');
    assert.ok(info, 'staging_variants table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('staging_variants');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('staging_product_id'), 'should have staging_product_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('raw_data'), 'should have raw_data');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('staging_variants');
    assert.strictEqual(hasRls, true, 'staging_variants should have RLS enabled');
  });

  void it('has FK to staging_products', async () => {
    const constraints = await getTableConstraints('staging_variants');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key constraint to staging_products');
  });
});
