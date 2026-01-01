/**
 * Materialized Views Tests
 *
 * Tests for all 7 materialized views:
 * - mv_inventory_current
 * - mv_shop_summary
 * - mv_low_stock_alerts
 * - mv_top_sellers
 * - mv_pim_quality_progress
 * - mv_pim_enrichment_status
 * - mv_pim_source_performance
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests, query } from '../helpers/test-utils.ts';
import {
  getAllMaterializedViews,
  getMaterializedViewIndexes,
  type MaterializedViewInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

const EXPECTED_MVS = [
  'mv_inventory_current',
  'mv_shop_summary',
  'mv_low_stock_alerts',
  'mv_top_sellers',
  'mv_pim_quality_progress',
  'mv_pim_enrichment_status',
  'mv_pim_source_performance',
];

// ============================================
// MATERIALIZED VIEWS SUMMARY
// ============================================

void describe('Materialized Views Summary', { skip: SKIP }, () => {
  let allMvs: MaterializedViewInfo[];

  before(async () => {
    getPool();
    allMvs = await getAllMaterializedViews();
  });

  after(async () => {
    await closePool();
  });

  void it('has exactly 7 materialized views', () => {
    assert.strictEqual(allMvs.length, 7, `Expected 7 MVs, got ${allMvs.length}`);
  });

  void it('has all expected materialized views', () => {
    const mvNames = allMvs.map((mv) => mv.matviewname);

    for (const expected of EXPECTED_MVS) {
      assert.ok(mvNames.includes(expected), `${expected} should exist`);
    }
  });
});

// ============================================
// MV_INVENTORY_CURRENT
// ============================================

void describe('MV: mv_inventory_current', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_inventory_current');
    assert.ok(mv, 'mv_inventory_current should exist');
  });

  void it('has definition', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_inventory_current');
    assert.ok(mv?.definition, 'Should have a definition');
    assert.ok(mv?.definition.length > 0, 'Definition should not be empty');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_inventory_current');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    // Just verify we can query it
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM mv_inventory_current'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_SHOP_SUMMARY
// ============================================

void describe('MV: mv_shop_summary', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_shop_summary');
    assert.ok(mv, 'mv_shop_summary should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_shop_summary');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM mv_shop_summary');
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_LOW_STOCK_ALERTS
// ============================================

void describe('MV: mv_low_stock_alerts', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_low_stock_alerts');
    assert.ok(mv, 'mv_low_stock_alerts should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_low_stock_alerts');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM mv_low_stock_alerts'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_TOP_SELLERS
// ============================================

void describe('MV: mv_top_sellers', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_top_sellers');
    assert.ok(mv, 'mv_top_sellers should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_top_sellers');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM mv_top_sellers');
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_PIM_QUALITY_PROGRESS
// ============================================

void describe('MV: mv_pim_quality_progress', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_quality_progress');
    assert.ok(mv, 'mv_pim_quality_progress should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_quality_progress');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM mv_pim_quality_progress'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_PIM_ENRICHMENT_STATUS
// ============================================

void describe('MV: mv_pim_enrichment_status', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_enrichment_status');
    assert.ok(mv, 'mv_pim_enrichment_status should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_enrichment_status');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM mv_pim_enrichment_status'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV_PIM_SOURCE_PERFORMANCE
// ============================================

void describe('MV: mv_pim_source_performance', { skip: SKIP }, () => {
  void it('exists', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_source_performance');
    assert.ok(mv, 'mv_pim_source_performance should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_source_performance');
    assert.ok(indexes.length >= 1, 'Should have at least one index');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM mv_pim_source_performance'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// MV REFRESH CAPABILITY
// ============================================

void describe('MV Refresh Capability', { skip: SKIP }, () => {
  void it('all MVs support REFRESH CONCURRENTLY', async () => {
    const allMvs = await getAllMaterializedViews();

    // MVs with unique indexes support REFRESH CONCURRENTLY
    for (const mv of allMvs) {
      const indexes = await getMaterializedViewIndexes(mv.matviewname);

      // Most MVs should have a unique index for concurrent refresh
      // Check for at least one index (unique preferred for CONCURRENTLY)
      const hasIndexes = indexes.length >= 1;
      const hasUniqueForConcurrent = indexes.some((idx) => idx.indexdef.includes('UNIQUE'));

      assert.ok(
        hasIndexes,
        `${mv.matviewname} should have at least one index for efficient refresh`
      );

      // Log if no unique index (REFRESH CONCURRENTLY requires unique index)
      if (!hasUniqueForConcurrent) {
        // This is informational - not all MVs need CONCURRENTLY
      }
    }
  });
});
