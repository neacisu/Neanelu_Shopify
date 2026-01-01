/**
 * Module H & I RLS Tests: Audit & Inventory
 *
 * Tests RLS policies for:
 * Module H - Audit:
 * - audit_logs
 * - sync_checkpoints
 *
 * Module I - Inventory:
 * - inventory_ledger
 * - inventory_locations
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Module H tables
const MODULE_H_TABLES = ['audit_logs', 'sync_checkpoints'];

// Module I tables
const MODULE_I_TABLES = ['inventory_ledger', 'inventory_locations'];

// ============================================
// MODULE H: AUDIT RLS
// ============================================

void describe('Module H RLS: Audit Tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of MODULE_H_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_H_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE H: POLICY CONTENT
// ============================================

void describe('Module H RLS: Policy Content', { skip: SKIP }, () => {
  void it('audit_logs policy references shop_id', async () => {
    const policies = await getTablePolicies('audit_logs');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'audit_logs policy should reference shop_id');
  });

  void it('sync_checkpoints policy references shop_id', async () => {
    const policies = await getTablePolicies('sync_checkpoints');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'sync_checkpoints policy should reference shop_id');
  });
});

// ============================================
// MODULE I: INVENTORY RLS
// ============================================

void describe('Module I RLS: Inventory Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_I_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_I_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE I: POLICY CONTENT
// ============================================

void describe('Module I RLS: Policy Content', { skip: SKIP }, () => {
  void it('inventory_ledger policy references shop_id', async () => {
    const policies = await getTablePolicies('inventory_ledger');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'inventory_ledger policy should reference shop_id');
  });

  void it('inventory_locations policy references shop_id', async () => {
    const policies = await getTablePolicies('inventory_locations');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'inventory_locations policy should reference shop_id');
  });
});

// ============================================
// PARTITIONED TABLE RLS
// ============================================

void describe('Module H & I RLS: Partitioned Tables', { skip: SKIP }, () => {
  void it('audit_logs (partitioned) has RLS on parent', async () => {
    const hasRls = await getTableRlsStatus('audit_logs');
    assert.strictEqual(hasRls, true, 'audit_logs parent should have RLS');
  });

  void it('inventory_ledger (partitioned) has RLS on parent', async () => {
    const hasRls = await getTableRlsStatus('inventory_ledger');
    assert.strictEqual(hasRls, true, 'inventory_ledger parent should have RLS');
  });
});
