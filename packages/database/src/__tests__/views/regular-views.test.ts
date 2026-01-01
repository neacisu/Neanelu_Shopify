/**
 * Regular Views Tests
 *
 * Tests for all 4 regular views:
 * - v_api_daily_costs
 * - v_table_stats
 * - v_index_stats
 * - v_schema_validation
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests, query } from '../helpers/test-utils.ts';
import { getAllViews } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

const EXPECTED_VIEWS = [
  'v_api_daily_costs',
  'v_table_stats',
  'v_index_stats',
  'v_schema_validation',
];

// ============================================
// VIEWS SUMMARY
// ============================================

void describe('Regular Views Summary', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 4 views', async () => {
    const views = await getAllViews();
    assert.ok(views.length >= 4, `Expected at least 4 views, got ${views.length}`);
  });

  void it('has all expected views', async () => {
    const views = await getAllViews();
    const viewNames = views.map((v) => v.viewname);

    for (const expected of EXPECTED_VIEWS) {
      assert.ok(viewNames.includes(expected), `${expected} should exist`);
    }
  });
});

// ============================================
// V_API_DAILY_COSTS
// ============================================

void describe('View: v_api_daily_costs', { skip: SKIP }, () => {
  void it('exists', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_api_daily_costs');
    assert.ok(view, 'v_api_daily_costs should exist');
  });

  void it('has definition', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_api_daily_costs');
    assert.ok(view?.definition, 'Should have a definition');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM v_api_daily_costs'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// V_TABLE_STATS
// ============================================

void describe('View: v_table_stats', { skip: SKIP }, () => {
  void it('exists', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_table_stats');
    assert.ok(view, 'v_table_stats should exist');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM v_table_stats');
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// V_INDEX_STATS
// ============================================

void describe('View: v_index_stats', { skip: SKIP }, () => {
  void it('exists', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_index_stats');
    assert.ok(view, 'v_index_stats should exist');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM v_index_stats');
    assert.ok(result[0], 'Should be queryable');
  });
});

// ============================================
// V_SCHEMA_VALIDATION
// ============================================

void describe('View: v_schema_validation', { skip: SKIP }, () => {
  void it('exists', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_schema_validation');
    assert.ok(view, 'v_schema_validation should exist');
  });

  void it('is queryable', async () => {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM v_schema_validation'
    );
    assert.ok(result[0], 'Should be queryable');
  });
});
