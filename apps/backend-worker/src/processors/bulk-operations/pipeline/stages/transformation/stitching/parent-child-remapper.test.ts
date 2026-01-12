import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import type { Logger } from '@app/logger';

import { ParentChildRemapper, type StitchedRecord } from './parent-child-remapper.js';

const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

function isVariant(r: StitchedRecord): r is Extract<StitchedRecord, { kind: 'variant' }> {
  return r.kind === 'variant';
}

function isOrphanVariantQuarantine(
  r: StitchedRecord
): r is Extract<StitchedRecord, { kind: 'quarantine_orphan_variant' }> {
  return r.kind === 'quarantine_orphan_variant';
}

function isProductMetafieldsPatch(
  r: StitchedRecord
): r is Extract<StitchedRecord, { kind: 'product_metafields_patch' }> {
  return r.kind === 'product_metafields_patch';
}

function isOrphanInventoryLevelQuarantine(
  r: StitchedRecord
): r is Extract<StitchedRecord, { kind: 'quarantine_orphan_inventory_level' }> {
  return r.kind === 'quarantine_orphan_inventory_level';
}

void describe('PR-041: ParentChildRemapper', () => {
  void it('stitches out-of-order ProductVariant via disk spill and quarantines true orphans', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-stitching-test-'));
    try {
      const records: StitchedRecord[] = [];

      const remapper = new ParentChildRemapper({
        shopId: 'shop-test',
        artifactsDir: tmp,
        logger: noopLogger,
        onRecord: (r) => {
          records.push(r);
        },
        bucketCount: 16,
        maxInMemoryParents: 2,
        maxInMemoryOrphans: 1, // force spill
      });

      await remapper.init();

      // Variant arrives before Product (out-of-order).
      await remapper.processLine({
        __typename: 'ProductVariant',
        id: 'gid://shopify/ProductVariant/10',
        __parentId: 'gid://shopify/Product/1',
        sku: 'SKU-10',
      });

      // True orphan (parent never appears).
      await remapper.processLine({
        __typename: 'ProductVariant',
        id: 'gid://shopify/ProductVariant/99',
        __parentId: 'gid://shopify/Product/999',
        sku: 'SKU-99',
      });

      // Parent appears after.
      await remapper.processLine({
        __typename: 'Product',
        id: 'gid://shopify/Product/1',
        title: 'P1',
      });

      await remapper.finalize();

      const variants = records.filter(isVariant);
      assert.equal(variants.length, 1);
      assert.equal(variants[0]!.id, 'gid://shopify/ProductVariant/10');
      assert.equal(variants[0]!.productId, 'gid://shopify/Product/1');

      const quarantined = records.filter(isOrphanVariantQuarantine);
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0]!.id, 'gid://shopify/ProductVariant/99');
      assert.equal(quarantined[0]!.missingParentId, 'gid://shopify/Product/999');

      const stitching = remapper.getCounters();
      assert.equal(stitching.variantsSeen, 2);
      assert.equal(stitching.variantsEmitted, 1);
      assert.ok(stitching.variantsSpilledToDisk >= 1);
      assert.equal(stitching.variantsQuarantined, 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  void it('emits metafield patches and quarantines orphan inventory levels', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-stitching-test-'));
    try {
      const records: StitchedRecord[] = [];

      const remapper = new ParentChildRemapper({
        shopId: 'shop-test',
        artifactsDir: tmp,
        logger: noopLogger,
        onRecord: (r) => {
          records.push(r);
        },
        bucketCount: 16,
        maxInMemoryParents: 10,
        maxInMemoryOrphans: 1,
      });

      await remapper.init();

      // Parent product
      await remapper.processLine({
        __typename: 'Product',
        id: 'gid://shopify/Product/1',
        title: 'P1',
      });

      // Metafield attached to product via owner
      await remapper.processLine({
        __typename: 'Metafield',
        id: 'gid://shopify/Metafield/1',
        namespace: 'custom',
        key: 'color',
        jsonValue: '"red"',
        owner: { __typename: 'Product', id: 'gid://shopify/Product/1' },
      });

      // Orphan inventory level: no InventoryItem ever appears
      await remapper.processLine({
        __typename: 'InventoryLevel',
        id: 'gid://shopify/InventoryLevel/1',
        __parentId: 'gid://shopify/InventoryItem/999',
        available: 3,
      });

      await remapper.finalize();

      const patches = records.filter(isProductMetafieldsPatch);
      assert.equal(patches.length, 1);
      assert.equal(patches[0]!.ownerId, 'gid://shopify/Product/1');
      assert.equal(patches[0]!.namespace, 'custom');
      assert.equal(patches[0]!.key, 'color');
      assert.deepEqual(patches[0]!.patch, { custom: { color: 'red' } });

      const invQuarantine = records.filter(isOrphanInventoryLevelQuarantine);
      assert.equal(invQuarantine.length, 1);
      assert.equal(invQuarantine[0]!.missingParentId, 'gid://shopify/InventoryItem/999');

      const stitching = remapper.getCounters();
      assert.equal(stitching.metafieldsSeen, 1);
      assert.equal(stitching.metafieldsEmitted, 1);
      assert.equal(stitching.inventoryLevelsSeen, 1);
      assert.equal(stitching.inventoryLevelsEmitted, 0);
      assert.equal(stitching.inventoryLevelsQuarantined, 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
