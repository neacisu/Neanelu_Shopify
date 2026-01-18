import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveIdempotencyKey, sha256Hex } from '../../state-machine.js';

void describe('bulk state machine helpers', () => {
  void it('sha256Hex returns deterministic output', () => {
    const a = sha256Hex('hello');
    const b = sha256Hex('hello');
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  void it('deriveIdempotencyKey is stable for identical inputs', () => {
    const keyA = deriveIdempotencyKey({
      shopId: 'shop-a',
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'core',
      graphqlQueryHash: 'abcd',
    });
    const keyB = deriveIdempotencyKey({
      shopId: 'shop-a',
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'core',
      graphqlQueryHash: 'abcd',
    });

    assert.equal(keyA, keyB);
  });

  void it('deriveIdempotencyKey changes when inputs differ', () => {
    const keyA = deriveIdempotencyKey({
      shopId: 'shop-a',
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'core',
      graphqlQueryHash: 'abcd',
    });
    const keyB = deriveIdempotencyKey({
      shopId: 'shop-a',
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'meta',
      graphqlQueryHash: 'abcd',
    });

    assert.notEqual(keyA, keyB);
  });
});
