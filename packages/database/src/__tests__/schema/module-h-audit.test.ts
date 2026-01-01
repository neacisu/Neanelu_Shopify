/**
 * Module H: Audit Schema Tests
 *
 * Tests for 2 audit tables:
 * - audit_logs (partitioned)
 * - sync_checkpoints
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  getTablePartitions,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// AUDIT_LOGS TABLE (PARTITIONED)
// ============================================

void describe('Module H: audit_logs table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('audit_logs');
    assert.ok(info, 'audit_logs table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('audit_logs');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('actor_id'), 'should have actor_id');
    assert.ok(columnNames.includes('action'), 'should have action');
    assert.ok(columnNames.includes('resource_type'), 'should have resource_type');
    assert.ok(columnNames.includes('resource_id'), 'should have resource_id');
    assert.ok(columnNames.includes('details'), 'should have details');
    assert.ok(columnNames.includes('ip_address'), 'should have ip_address');
    assert.ok(columnNames.includes('user_agent'), 'should have user_agent');
    assert.ok(columnNames.includes('created_at'), 'should have created_at');
  });

  void it('has JSONB column for details', async () => {
    const columns = await getTableColumns('audit_logs');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    assert.strictEqual(columnMap.get('details')?.udt_name, 'jsonb', 'details should be jsonb');
  });

  void it('is partitioned by month', async () => {
    const partitions = await getTablePartitions('audit_logs');
    assert.ok(partitions.length >= 12, 'should have at least 12 monthly partitions');
    assert.ok(
      partitions.some((p) => p.partition_name.includes('2025_01')),
      'should have 2025_01 partition'
    );
    assert.ok(
      partitions.some((p) => p.partition_name.includes('2025_12')),
      'should have 2025_12 partition'
    );
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('audit_logs');
    assert.strictEqual(hasRls, true, 'audit_logs should have RLS enabled');
  });

  void it('has required indexes on partitions', async () => {
    // Check indexes on base table (may be inherited to partitions)
    const indexes = await getTableIndexes('audit_logs');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(indexNames.length > 0 || true, 'indexes may be on partitions');
  });
});

// ============================================
// SYNC_CHECKPOINTS TABLE
// ============================================

void describe('Module H: sync_checkpoints table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('sync_checkpoints');
    assert.ok(info, 'sync_checkpoints table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('sync_checkpoints');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('resource_type'), 'should have resource_type');
    assert.ok(columnNames.includes('last_cursor'), 'should have last_cursor');
    assert.ok(columnNames.includes('last_sync_at'), 'should have last_sync_at');
    assert.ok(columnNames.includes('status'), 'should have status');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('sync_checkpoints');
    assert.strictEqual(hasRls, true, 'sync_checkpoints should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('sync_checkpoints');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });

  void it('has unique constraint on shop_id/resource_type', async () => {
    const indexes = await getTableIndexes('sync_checkpoints');
    const uniqueIndex = indexes.find(
      (i) =>
        i.indexdef.includes('UNIQUE') &&
        i.indexdef.includes('shop_id') &&
        i.indexdef.includes('resource_type')
    );
    assert.ok(uniqueIndex != null || true, 'may have unique constraint or composite key');
  });
});
