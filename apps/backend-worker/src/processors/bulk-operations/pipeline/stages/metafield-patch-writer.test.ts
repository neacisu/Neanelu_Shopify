import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { StitchedRecord } from '../../pipeline/stages/transformation/stitching/parent-child-remapper.js';

// ---------------------------------------------------------------------------
// Minimal stubs for dependencies that require DB / OTel infrastructure
// ---------------------------------------------------------------------------

// Stub withTenantContext: runs the callback with a simple mock client
const executedSqls: { sql: string; values: unknown[] }[] = [];
let shouldFailNextQuery = false;

mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (_shopId: string, fn: (client: unknown) => Promise<unknown>) => {
      const client = {
        query: (sql: string, values: unknown[]) => {
          if (shouldFailNextQuery) {
            shouldFailNextQuery = false;
            throw new Error('simulated_db_error');
          }
          executedSqls.push({ sql, values });
          return { rowCount: values.length > 0 ? 1 : 0 };
        },
      };
      return fn(client);
    },
  },
});

// Stub withBulkSpan: just runs the callback
mock.module('../../otel/spans.js', {
  namedExports: {
    withBulkSpan: async (
      _name: string,
      _attrs: unknown,
      fn: (span: unknown) => Promise<unknown>
    ) => {
      const fakeSpan = { setAttribute: () => undefined };
      return fn(fakeSpan);
    },
  },
});

// Stub insertBulkError: no-op
mock.module('../../state-machine.js', {
  namedExports: {
    insertBulkError: () => undefined,
  },
});

// ---------------------------------------------------------------------------
// Import the class under test AFTER mocks are set up
// ---------------------------------------------------------------------------
const { MetafieldPatchWriter, StagingCopyWriter } = await import('./copy-writer.js');

function makeWriter(batchMaxRows = 5) {
  return new MetafieldPatchWriter({
    shopId: 'shop-test',
    bulkRunId: 'run-test',
    batchMaxRows,
  });
}

function makeProductPatch(
  ownerId: string,
  ns: string,
  key: string,
  value: unknown
): Extract<StitchedRecord, { kind: 'product_metafields_patch' }> {
  return {
    kind: 'product_metafields_patch',
    ownerId,
    namespace: ns,
    key,
    patch: { [ns]: { [key]: value } },
    metafields: [{ namespace: ns, key, jsonValue: value, value: String(value) }],
  } as unknown as Extract<StitchedRecord, { kind: 'product_metafields_patch' }>;
}

void describe('MetafieldPatchWriter', () => {
  beforeEach(() => {
    executedSqls.length = 0;
    shouldFailNextQuery = false;
  });

  void it('buffers product metafield patches and flushes at threshold', async () => {
    const writer = makeWriter(3);
    const patch = makeProductPatch('gid://shopify/Product/1', 'custom', 'color', 'red');

    writer.handleProductPatch(patch);
    assert.equal(writer.shouldFlush(), false);
    assert.equal(writer.getCounters().productPatchesBuffered, 1);

    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/2', 'custom', 'size', 'M'));
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/3', 'custom', 'weight', 1.5));

    assert.equal(writer.shouldFlush(), true);

    await writer.flush();

    const counters = writer.getCounters();
    assert.equal(counters.productPatchesFlushed, 3);
    assert.equal(counters.flushErrors, 0);
    assert.ok(executedSqls.length >= 1, 'should execute at least one UPDATE');
  });

  void it('merges multiple metafields for same GID correctly in memory', async () => {
    const writer = makeWriter(100);
    const p1color = makeProductPatch('gid://shopify/Product/1', 'custom', 'color', 'blue');
    const p1size = makeProductPatch('gid://shopify/Product/1', 'custom', 'size', 'L');

    writer.handleProductPatch(p1color);
    writer.handleProductPatch(p1size);

    await writer.flush();

    // Only 1 UPDATE should be executed (1 GID, merged patch)
    const productUpdates = executedSqls.filter(
      (s) => s.sql.includes('shopify_products') && s.sql.includes('UPDATE')
    );
    assert.equal(productUpdates.length, 1, 'should be a single batch UPDATE for 1 GID');
  });

  void it('handles variant metafield patches separately', async () => {
    const writer = makeWriter(100);

    writer.handleVariantPatch({
      kind: 'variant_metafields_patch',
      ownerId: 'gid://shopify/ProductVariant/10',
      namespace: 'custom',
      key: 'material',
      patch: { custom: { material: 'cotton' } },
      metafields: [{ namespace: 'custom', key: 'material', jsonValue: 'cotton', value: 'cotton' }],
    } as unknown as Extract<StitchedRecord, { kind: 'variant_metafields_patch' }>);

    await writer.flush();

    const counters = writer.getCounters();
    assert.equal(counters.variantPatchesFlushed, 1);
    assert.equal(counters.productPatchesFlushed, 0);

    const variantUpdates = executedSqls.filter(
      (s) => s.sql.includes('shopify_variants') && s.sql.includes('UPDATE')
    );
    assert.equal(variantUpdates.length, 1);
  });

  void it('idempotent: flushing same patch twice yields same result', async () => {
    const writer = makeWriter(100);
    const patch = makeProductPatch('gid://shopify/Product/42', 'seo', 'title', 'My Product');

    writer.handleProductPatch(patch);
    await writer.flush();
    const countAfterFirst = executedSqls.length;

    // Re-apply same patch (simulating resume on crash)
    writer.handleProductPatch(patch);
    await writer.flush();
    const countAfterSecond = executedSqls.length;

    // Both flushes should have produced one UPDATE each
    assert.equal(countAfterSecond - countAfterFirst, countAfterFirst);
  });

  void it('flush error is non-fatal and increments flushErrors counter', async () => {
    const writer = makeWriter(100);
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/99', 'custom', 'foo', 'bar'));

    shouldFailNextQuery = true;
    await writer.flush(); // should not throw

    const counters = writer.getCounters();
    assert.equal(counters.flushErrors, 1);
    assert.equal(counters.productPatchesFlushed, 0);
  });

  void it('flush on empty buffer is a no-op', async () => {
    const writer = makeWriter(100);
    await writer.flush();
    assert.equal(executedSqls.length, 0);
    const counters = writer.getCounters();
    assert.equal(counters.productPatchesFlushed, 0);
    assert.equal(counters.variantPatchesFlushed, 0);
  });

  void it('shouldFlush returns false below threshold', () => {
    const writer = makeWriter(5);
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/1', 'custom', 'x', 1));
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/2', 'custom', 'x', 1));
    assert.equal(writer.shouldFlush(), false);
  });

  void it('shouldFlush returns true at or above threshold', () => {
    const writer = makeWriter(2);
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/1', 'custom', 'x', 1));
    writer.handleProductPatch(makeProductPatch('gid://shopify/Product/2', 'custom', 'x', 1));
    assert.equal(writer.shouldFlush(), true);
  });

  void it('skip staging when skipProductStaging is true', async () => {
    const writer = new StagingCopyWriter({
      shopId: 'shop-test',
      bulkRunId: 'run-test',
      batchMaxRows: 500,
      batchMaxBytes: 1_000_000,
      skipProductStaging: true,
    });

    // Product record should be skipped
    const productResult = await writer.handleRecord({
      kind: 'product',
      id: 'gid://shopify/Product/1',
      raw: {
        id: 'gid://shopify/Product/1',
        __typename: 'Product',
        title: 'P1',
        handle: 'p1',
        status: 'ACTIVE',
      },
    } as unknown as StitchedRecord);
    assert.equal(productResult.flushed, false);

    // Variant record should be skipped
    const variantResult = await writer.handleRecord({
      kind: 'variant',
      id: 'gid://shopify/ProductVariant/10',
      productId: 'gid://shopify/Product/1',
      raw: {
        id: 'gid://shopify/ProductVariant/10',
        __typename: 'ProductVariant',
        product: { id: 'gid://shopify/Product/1' },
        title: 'V1',
        sku: 'SKU-1',
        price: '10.00',
      },
    } as unknown as StitchedRecord);
    assert.equal(variantResult.flushed, false);

    const counters = writer.getCounters();
    assert.equal(counters.productsBuffered, 0, 'products should not be buffered');
    assert.equal(counters.variantsBuffered, 0, 'variants should not be buffered');
    assert.equal(counters.recordsSkipped, 2, 'both records should be skipped');

    // Metafield patch should still work
    const patchResult = await writer.handleRecord({
      kind: 'product_metafields_patch',
      ownerId: 'gid://shopify/Product/1',
      namespace: 'custom',
      key: 'color',
      value: 'red',
      patch: { custom: { color: 'red' } },
      raw: { id: 'gid://shopify/Metafield/1', __typename: 'Metafield' },
    } as unknown as StitchedRecord);
    assert.equal(patchResult.flushed, false);

    const afterCounters = writer.getCounters();
    assert.equal(
      afterCounters.metafieldProductPatchesBuffered,
      1,
      'metafield patches should still be buffered'
    );
  });

  void it('flush drains remaining metafield patches even when no staging rows exist', async () => {
    const writer = new StagingCopyWriter({
      shopId: 'shop-test',
      bulkRunId: 'run-test',
      batchMaxRows: 500,
      batchMaxBytes: 1_000_000,
      skipProductStaging: true,
    });

    // Add a metafield patch (below threshold, won't auto-flush)
    await writer.handleRecord({
      kind: 'product_metafields_patch',
      ownerId: 'gid://shopify/Product/42',
      namespace: 'seo',
      key: 'title',
      value: 'Optimized Title',
      patch: { seo: { title: 'Optimized Title' } },
      raw: { id: 'gid://shopify/Metafield/99', __typename: 'Metafield' },
    } as unknown as StitchedRecord);

    const beforeFlush = writer.getCounters();
    assert.equal(beforeFlush.metafieldProductPatchesFlushed, 0, 'not flushed yet');
    assert.equal(beforeFlush.metafieldProductPatchesBuffered, 1, 'buffered');

    // Final flush should drain metafield patches even though no staging rows exist
    executedSqls.length = 0;
    await writer.flush();

    const afterFlush = writer.getCounters();
    assert.equal(afterFlush.metafieldProductPatchesFlushed, 1, 'flushed after drain');
    assert.ok(
      executedSqls.some((s) => s.sql.includes('UPDATE') && s.sql.includes('shopify_products')),
      'should have executed UPDATE on shopify_products'
    );
  });
});
