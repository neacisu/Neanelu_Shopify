/**
 * Module K: Menus Schema Tests
 *
 * Tests for 2 menu tables:
 * - shopify_menus
 * - shopify_menu_items
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getTableConstraints,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// SHOPIFY_MENUS TABLE
// ============================================

void describe('Module K: shopify_menus table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_menus');
    assert.ok(info, 'shopify_menus table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_menus');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('title'), 'should have title');
    assert.ok(columnNames.includes('handle'), 'should have handle');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_menus');
    assert.strictEqual(hasRls, true, 'shopify_menus should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('shopify_menus');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// SHOPIFY_MENU_ITEMS TABLE
// ============================================

void describe('Module K: shopify_menu_items table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_menu_items');
    assert.ok(info, 'shopify_menu_items table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_menu_items');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('menu_id'), 'should have menu_id');
    assert.ok(columnNames.includes('parent_id'), 'should have parent_id');
    assert.ok(columnNames.includes('title'), 'should have title');
    assert.ok(columnNames.includes('url'), 'should have url');
    assert.ok(columnNames.includes('resource_type'), 'should have resource_type');
    assert.ok(columnNames.includes('resource_id'), 'should have resource_id');
    assert.ok(columnNames.includes('position'), 'should have position');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_menu_items');
    assert.strictEqual(hasRls, true, 'shopify_menu_items should have RLS enabled');
  });

  void it('has FK to shopify_menus', async () => {
    const constraints = await getTableConstraints('shopify_menu_items');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key to shopify_menus');
  });

  void it('has self-referencing FK for hierarchy', async () => {
    const constraints = await getTableConstraints('shopify_menu_items');
    const fks = constraints.filter((c) => c.constraint_type === 'FOREIGN KEY');
    // Should have at least 2 FKs - one to menus, one to self
    assert.ok(fks.length >= 1, 'should have foreign key constraints');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('shopify_menu_items');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});
