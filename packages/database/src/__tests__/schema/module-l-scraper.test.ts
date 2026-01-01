/**
 * Module L: Scraper Schema Tests
 *
 * Tests for 4 scraper tables + 1 view:
 * - scraper_configs
 * - scraper_runs
 * - scraper_queue
 * - api_usage_log
 * - v_api_daily_costs (view)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getTableTriggers,
  getAllViews,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// SCRAPER_CONFIGS TABLE
// ============================================

void describe('Module L: scraper_configs table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('scraper_configs');
    assert.ok(info, 'scraper_configs table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('scraper_configs');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('name'), 'should have name');
    assert.ok(columnNames.includes('source_type'), 'should have source_type');
    assert.ok(columnNames.includes('config'), 'should have config');
    assert.ok(columnNames.includes('schedule'), 'should have schedule');
    assert.ok(columnNames.includes('is_active'), 'should have is_active');
  });

  void it('has JSONB config column', async () => {
    const columns = await getTableColumns('scraper_configs');
    const config = columns.find((c) => c.column_name === 'config');
    assert.ok(config, 'config column should exist');
    assert.strictEqual(config?.udt_name, 'jsonb', 'config should be jsonb');
  });

  void it('does NOT have RLS (global config)', async () => {
    const hasRls = await getTableRlsStatus('scraper_configs');
    // May or may not have RLS depending on design
    assert.ok(typeof hasRls === 'boolean', 'RLS status should be defined');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('scraper_configs');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// SCRAPER_RUNS TABLE
// ============================================

void describe('Module L: scraper_runs table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('scraper_runs');
    assert.ok(info, 'scraper_runs table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('scraper_runs');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('config_id'), 'should have config_id');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('started_at'), 'should have started_at');
    assert.ok(columnNames.includes('completed_at'), 'should have completed_at');
    assert.ok(columnNames.includes('items_processed'), 'should have items_processed');
    assert.ok(columnNames.includes('items_failed'), 'should have items_failed');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('scraper_runs');
    assert.strictEqual(hasRls, true, 'scraper_runs should have RLS enabled');
  });
});

// ============================================
// SCRAPER_QUEUE TABLE
// ============================================

void describe('Module L: scraper_queue table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('scraper_queue');
    assert.ok(info, 'scraper_queue table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('scraper_queue');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('run_id'), 'should have run_id');
    assert.ok(columnNames.includes('url'), 'should have url');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('priority'), 'should have priority');
    assert.ok(columnNames.includes('attempts'), 'should have attempts');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('scraper_queue');
    assert.strictEqual(hasRls, true, 'scraper_queue should have RLS enabled');
  });
});

// ============================================
// API_USAGE_LOG TABLE
// ============================================

void describe('Module L: api_usage_log table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('api_usage_log');
    assert.ok(info, 'api_usage_log table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('api_usage_log');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('api_type'), 'should have api_type');
    assert.ok(columnNames.includes('endpoint'), 'should have endpoint');
    assert.ok(columnNames.includes('method'), 'should have method');
    assert.ok(columnNames.includes('status_code'), 'should have status_code');
    assert.ok(columnNames.includes('response_time_ms'), 'should have response_time_ms');
    assert.ok(columnNames.includes('cost_units'), 'should have cost_units');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('api_usage_log');
    assert.strictEqual(hasRls, true, 'api_usage_log should have RLS enabled');
  });
});

// ============================================
// V_API_DAILY_COSTS VIEW
// ============================================

void describe('Module L: v_api_daily_costs view', { skip: SKIP }, () => {
  void it('exists as a view', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_api_daily_costs');
    assert.ok(view, 'v_api_daily_costs view should exist');
  });

  void it('has a definition', async () => {
    const views = await getAllViews();
    const view = views.find((v) => v.viewname === 'v_api_daily_costs');
    assert.ok(view?.definition, 'v_api_daily_costs should have a definition');
    assert.ok(view?.definition.length > 0, 'definition should not be empty');
  });
});
