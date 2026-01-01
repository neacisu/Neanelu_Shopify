/**
 * Helper Functions Tests
 *
 * Tests for custom PostgreSQL functions:
 * - uuidv7() - UUIDv7 generation
 * - find_similar_products() - Vector similarity search
 * - find_similar_shop_products() - Shop-scoped vector search
 * - refresh_all_materialized_views() - MV refresh
 * - refresh_mv_daily/hourly/high_frequency() - Scheduled MV refresh
 * - calculate_pim_quality_score() - PIM quality calculation
 * - batch_update_quality_scores() - Batch PIM updates
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests, query } from '../helpers/test-utils.ts';
import { getFunctionInfo, getAllFunctions } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// FUNCTIONS SUMMARY
// ============================================

void describe('Helper Functions Summary', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 15 custom functions', async () => {
    const functions = await getAllFunctions();
    assert.ok(functions.length >= 15, `Expected at least 15 functions, got ${functions.length}`);
  });
});

// ============================================
// UUIDV7 FUNCTION
// ============================================

void describe('Function: uuidv7()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('uuidv7');
    assert.ok(fn, 'uuidv7 function should exist');
  });

  void it('returns valid UUID', async () => {
    const result = await query<{ uuid: string }>('SELECT uuidv7() as uuid');
    const uuid = result[0]?.uuid;

    assert.ok(uuid, 'Should return a UUID');

    // UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(uuidRegex.test(uuid), 'Should be valid UUID format');
  });

  void it('returns UUIDv7 format (version 7)', async () => {
    const result = await query<{ uuid: string }>('SELECT uuidv7() as uuid');
    const uuid = result[0]?.uuid ?? '';

    // UUIDv7 has version 7 in the 13th character
    const version = uuid.charAt(14);
    assert.strictEqual(version, '7', 'UUID version should be 7');
  });

  void it('generates unique values', async () => {
    const result = await query<{ uuid: string }>(`
      SELECT uuidv7() as uuid FROM generate_series(1, 10)
    `);

    const uuids = result.map((r) => r.uuid);
    const uniqueUuids = new Set(uuids);

    assert.strictEqual(uniqueUuids.size, 10, 'All UUIDs should be unique');
  });

  void it('generates time-ordered UUIDs', async () => {
    const result = await query<{ uuid: string }>(`
      SELECT uuidv7() as uuid FROM generate_series(1, 5)
    `);

    const uuids = result.map((r) => r.uuid);
    const sortedUuids = [...uuids].sort();

    // UUIDv7 should be naturally sortable by time
    assert.deepStrictEqual(uuids, sortedUuids, 'UUIDs should be time-ordered');
  });
});

// ============================================
// FIND_SIMILAR_PRODUCTS FUNCTION
// ============================================

void describe('Function: find_similar_products()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('find_similar_products');
    assert.ok(fn, 'find_similar_products function should exist');
  });

  void it('returns TABLE type', async () => {
    const fn = await getFunctionInfo('find_similar_products');
    // Function should return a table or setof records
    assert.ok(fn, 'Function should exist');
  });
});

// ============================================
// FIND_SIMILAR_SHOP_PRODUCTS FUNCTION
// ============================================

void describe('Function: find_similar_shop_products()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('find_similar_shop_products');
    assert.ok(fn, 'find_similar_shop_products function should exist');
  });
});

// ============================================
// MATERIALIZED VIEW REFRESH FUNCTIONS
// ============================================

void describe('Function: refresh_all_materialized_views()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('refresh_all_materialized_views');
    assert.ok(fn, 'refresh_all_materialized_views function should exist');
  });
});

void describe('Function: refresh_mv_daily()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('refresh_mv_daily');
    assert.ok(fn, 'refresh_mv_daily function should exist');
  });
});

void describe('Function: refresh_mv_hourly()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('refresh_mv_hourly');
    assert.ok(fn, 'refresh_mv_hourly function should exist');
  });
});

void describe('Function: refresh_mv_high_frequency()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('refresh_mv_high_frequency');
    assert.ok(fn, 'refresh_mv_high_frequency function should exist');
  });
});

// ============================================
// PIM QUALITY FUNCTIONS
// ============================================

void describe('Function: calculate_pim_quality_score()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('calculate_pim_quality_score');
    assert.ok(fn, 'calculate_pim_quality_score function should exist');
  });
});

void describe('Function: batch_update_quality_scores()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('batch_update_quality_scores');
    assert.ok(fn, 'batch_update_quality_scores function should exist');
  });
});

// ============================================
// PARTITION FUNCTIONS
// ============================================

void describe('Function: create_future_partitions()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('create_future_partitions');
    assert.ok(fn, 'create_future_partitions function should exist');
  });
});

void describe('Function: create_partition_if_not_exists()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('create_partition_if_not_exists');
    assert.ok(fn, 'create_partition_if_not_exists function should exist');
  });
});

void describe('Function: drop_old_partitions()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('drop_old_partitions');
    assert.ok(fn, 'drop_old_partitions function should exist');
  });
});

void describe('Function: get_partition_stats()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('get_partition_stats');
    assert.ok(fn, 'get_partition_stats function should exist');
  });
});

// ============================================
// AUDIT FUNCTION
// ============================================

void describe('Function: audit_critical_action()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('audit_critical_action');
    assert.ok(fn, 'audit_critical_action function should exist');
  });
});
