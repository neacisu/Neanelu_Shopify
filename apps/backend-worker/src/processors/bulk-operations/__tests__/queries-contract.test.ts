import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getBulkQueryContract } from '../queries/index.js';

void describe('PR-038 bulk query contract', () => {
  void it('returns non-empty PRODUCTS_EXPORT v1 contracts for core/meta/inventory', () => {
    const core = getBulkQueryContract({
      operationType: 'PRODUCTS_EXPORT',
      querySet: 'core',
      version: 'v1',
    });
    const meta = getBulkQueryContract({
      operationType: 'PRODUCTS_EXPORT',
      querySet: 'meta',
      version: 'v1',
    });
    const inv = getBulkQueryContract({
      operationType: 'PRODUCTS_EXPORT',
      querySet: 'inventory',
      version: 'v1',
    });

    for (const c of [core, meta, inv]) {
      assert.equal(c.operationType, 'PRODUCTS_EXPORT');
      assert.equal(c.version, 'v1');
      assert.ok(c.graphqlQuery.includes('products('), 'expected products connection');
      assert.ok(c.graphqlQuery.includes('__typename'), 'expected __typename for robust parsing');
      assert.ok(c.stitching.executionOrder.length === 3);
    }
  });

  void it('defaults to v2 and includes plan-required stitching fields', () => {
    const core = getBulkQueryContract({ operationType: 'PRODUCTS_EXPORT', querySet: 'core' });
    const meta = getBulkQueryContract({ operationType: 'PRODUCTS_EXPORT', querySet: 'meta' });
    const inv = getBulkQueryContract({ operationType: 'PRODUCTS_EXPORT', querySet: 'inventory' });

    assert.equal(core.version, 'v2');
    assert.equal(meta.version, 'v2');
    assert.equal(inv.version, 'v2');

    // Core must include variant.product.id (logical stitching key per plan).
    assert.ok(core.graphqlQuery.includes('product {\n            id\n          }'));

    // Meta must include metafield.owner.id (logical stitching key per plan).
    assert.ok(meta.graphqlQuery.includes('owner'));
    assert.ok(meta.graphqlQuery.includes('... on Product'));

    // Inventory must include per-location inventoryLevels.
    assert.ok(inv.graphqlQuery.includes('inventoryLevels'));
    assert.ok(inv.graphqlQuery.includes('inventoryLevels(first: 250) {\n              nodes'));
    assert.ok(inv.graphqlQuery.includes('location'));
  });

  void it('throws on unsupported operation types', () => {
    const badInput = {
      operationType: 'ORDERS_EXPORT',
      querySet: 'core',
      version: 'v1',
    } as unknown as Parameters<typeof getBulkQueryContract>[0];

    assert.throws(() => getBulkQueryContract(badInput), { name: 'Error' });
  });
});
