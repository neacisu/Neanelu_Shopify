import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { extractResourceGid } from '../translations.js';

void describe('extractResourceGid', () => {
  void test('returnează GID-ul când resource_id este deja gid://', () => {
    assert.strictEqual(
      extractResourceGid({
        resource_id: 'gid://shopify/Product/123',
        resource_type: 'Product',
      }),
      'gid://shopify/Product/123'
    );
  });

  void test('construiește GID din resource_type + id string (REST-style)', () => {
    assert.strictEqual(
      extractResourceGid({
        resource_type: 'Product',
        id: '9876543210',
      }),
      'gid://shopify/Product/9876543210'
    );
  });

  void test('construiește GID din resource_type + resource_id numeric (JSON)', () => {
    assert.strictEqual(
      extractResourceGid({
        resource_type: 'Collection',
        resource_id: 42,
      }),
      'gid://shopify/Collection/42'
    );
  });

  void test('preferă câmpul id în fața resource_id pentru segmentul legacy', () => {
    assert.strictEqual(
      extractResourceGid({
        resource_type: 'Product',
        id: '1',
        resource_id: '2',
      }),
      'gid://shopify/Product/1'
    );
  });

  void test('nu folosește obiecte ca segment ID (evită stringificare greșită)', () => {
    assert.strictEqual(
      extractResourceGid({
        resource_type: 'Product',
        id: { nested: true },
        resource_id: { bad: true },
      }),
      null
    );
  });

  void test('returnează null fără resource_type chiar dacă există id', () => {
    assert.strictEqual(extractResourceGid({ id: '1' }), null);
  });
});
