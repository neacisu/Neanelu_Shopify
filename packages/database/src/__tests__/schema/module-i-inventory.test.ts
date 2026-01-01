/**
 * Module I: Inventory Schema Tests
 *
 * Tests for 2 tables + 1 MV:
 * - inventory_ledger (partitioned)
 * - inventory_locations
 * - mv_inventory_current (materialized view)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getTablePartitions,
  getAllMaterializedViews,
  getMaterializedViewIndexes,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// INVENTORY_LEDGER TABLE (PARTITIONED)
// ============================================

void describe('Module I: inventory_ledger table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('inventory_ledger');
    assert.ok(info, 'inventory_ledger table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('inventory_ledger');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('variant_id'), 'should have variant_id');
    assert.ok(columnNames.includes('location_id'), 'should have location_id');
    assert.ok(columnNames.includes('quantity_change'), 'should have quantity_change');
    assert.ok(columnNames.includes('reason'), 'should have reason');
    assert.ok(columnNames.includes('reference_type'), 'should have reference_type');
    assert.ok(columnNames.includes('reference_id'), 'should have reference_id');
    assert.ok(columnNames.includes('recorded_at'), 'should have recorded_at');
  });

  void it('is partitioned by month', async () => {
    const partitions = await getTablePartitions('inventory_ledger');
    assert.ok(partitions.length >= 12, 'should have at least 12 monthly partitions');
    assert.ok(
      partitions.some((p) => p.partition_name.includes('2025')),
      'should have 2025 partitions'
    );
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('inventory_ledger');
    assert.strictEqual(hasRls, true, 'inventory_ledger should have RLS enabled');
  });
});

// ============================================
// INVENTORY_LOCATIONS TABLE
// ============================================

void describe('Module I: inventory_locations table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('inventory_locations');
    assert.ok(info, 'inventory_locations table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('inventory_locations');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_location_id'), 'should have shopify_location_id');
    assert.ok(columnNames.includes('name'), 'should have name');
    assert.ok(columnNames.includes('is_active'), 'should have is_active');
    assert.ok(columnNames.includes('address'), 'should have address');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('inventory_locations');
    assert.strictEqual(hasRls, true, 'inventory_locations should have RLS enabled');
  });
});

// ============================================
// MV_INVENTORY_CURRENT MATERIALIZED VIEW
// ============================================

void describe('Module I: mv_inventory_current materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_inventory_current');
    assert.ok(mv, 'mv_inventory_current should exist');
  });

  void it('has indexes for efficient queries', async () => {
    const indexes = await getMaterializedViewIndexes('mv_inventory_current');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});
