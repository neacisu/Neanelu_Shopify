import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveIdempotencyKey, isValidBulkRunTransition, sha256Hex } from '../../state-machine.js';

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

  void it('accepts valid bulk run transitions', () => {
    assert.equal(isValidBulkRunTransition('pending', 'running'), true);
    assert.equal(isValidBulkRunTransition('running', 'completed'), true);
    assert.equal(isValidBulkRunTransition('running', 'failed'), true);
    assert.equal(isValidBulkRunTransition('pending', 'failed'), true);
  });

  void it('allows resume in intermediate states (idempotent)', () => {
    assert.equal(isValidBulkRunTransition('pending', 'pending'), true);
    assert.equal(isValidBulkRunTransition('running', 'running'), true);
  });

  void it('rejects invalid bulk run transitions', () => {
    assert.equal(isValidBulkRunTransition('completed', 'running'), false);
    assert.equal(isValidBulkRunTransition('failed', 'completed'), false);
    assert.equal(isValidBulkRunTransition('pending', 'completed'), false);
    assert.equal(isValidBulkRunTransition('unknown', 'running'), false);
  });
});
