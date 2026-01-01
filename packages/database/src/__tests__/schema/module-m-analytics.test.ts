/**
 * Module M: Analytics Schema Tests
 *
 * Tests for 2 tables + 6 materialized views:
 * - analytics_daily_shop
 * - analytics_product_performance
 * - mv_shop_summary
 * - mv_low_stock_alerts
 * - mv_top_sellers
 * - mv_pim_quality_progress
 * - mv_pim_enrichment_status
 * - mv_pim_source_performance
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getAllMaterializedViews,
  getMaterializedViewIndexes,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// ANALYTICS_DAILY_SHOP TABLE
// ============================================

void describe('Module M: analytics_daily_shop table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('analytics_daily_shop');
    assert.ok(info, 'analytics_daily_shop table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('analytics_daily_shop');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('date'), 'should have date');
    assert.ok(columnNames.includes('total_orders'), 'should have total_orders');
    assert.ok(columnNames.includes('total_revenue'), 'should have total_revenue');
    assert.ok(columnNames.includes('total_products'), 'should have total_products');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('analytics_daily_shop');
    assert.strictEqual(hasRls, true, 'analytics_daily_shop should have RLS enabled');
  });
});

// ============================================
// ANALYTICS_PRODUCT_PERFORMANCE TABLE
// ============================================

void describe('Module M: analytics_product_performance table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('analytics_product_performance');
    assert.ok(info, 'analytics_product_performance table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('analytics_product_performance');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('date'), 'should have date');
    assert.ok(columnNames.includes('views'), 'should have views');
    assert.ok(columnNames.includes('add_to_carts'), 'should have add_to_carts');
    assert.ok(columnNames.includes('purchases'), 'should have purchases');
    assert.ok(columnNames.includes('revenue'), 'should have revenue');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('analytics_product_performance');
    assert.strictEqual(hasRls, true, 'analytics_product_performance should have RLS enabled');
  });
});

// ============================================
// MV_SHOP_SUMMARY MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_shop_summary materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_shop_summary');
    assert.ok(mv, 'mv_shop_summary should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_shop_summary');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// MV_LOW_STOCK_ALERTS MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_low_stock_alerts materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_low_stock_alerts');
    assert.ok(mv, 'mv_low_stock_alerts should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_low_stock_alerts');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// MV_TOP_SELLERS MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_top_sellers materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_top_sellers');
    assert.ok(mv, 'mv_top_sellers should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_top_sellers');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// MV_PIM_QUALITY_PROGRESS MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_pim_quality_progress materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_quality_progress');
    assert.ok(mv, 'mv_pim_quality_progress should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_quality_progress');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// MV_PIM_ENRICHMENT_STATUS MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_pim_enrichment_status materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_enrichment_status');
    assert.ok(mv, 'mv_pim_enrichment_status should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_enrichment_status');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// MV_PIM_SOURCE_PERFORMANCE MATERIALIZED VIEW
// ============================================

void describe('Module M: mv_pim_source_performance materialized view', { skip: SKIP }, () => {
  void it('exists as a materialized view', async () => {
    const mvs = await getAllMaterializedViews();
    const mv = mvs.find((m) => m.matviewname === 'mv_pim_source_performance');
    assert.ok(mv, 'mv_pim_source_performance should exist');
  });

  void it('has indexes', async () => {
    const indexes = await getMaterializedViewIndexes('mv_pim_source_performance');
    assert.ok(indexes.length >= 1, 'should have at least one index');
  });
});

// ============================================
// ALL MATERIALIZED VIEWS SUMMARY
// ============================================

void describe('Module M: All Materialized Views Summary', { skip: SKIP }, () => {
  void it('has all 7 expected materialized views', async () => {
    const mvs = await getAllMaterializedViews();
    const mvNames = mvs.map((m) => m.matviewname);

    const expectedMvs = [
      'mv_inventory_current',
      'mv_shop_summary',
      'mv_low_stock_alerts',
      'mv_top_sellers',
      'mv_pim_quality_progress',
      'mv_pim_enrichment_status',
      'mv_pim_source_performance',
    ];

    for (const expected of expectedMvs) {
      assert.ok(mvNames.includes(expected), `${expected} should exist`);
    }

    assert.strictEqual(mvs.length, 7, 'should have exactly 7 materialized views');
  });
});
