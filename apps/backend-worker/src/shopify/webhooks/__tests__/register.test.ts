import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { enumToTopic, normalizeCallbackUrl, topicToEnum } from '../register.js';

void describe('normalizeCallbackUrl', () => {
  void test('comprimă slash-uri duplicate în pathname (URL valid)', () => {
    assert.strictEqual(
      normalizeCallbackUrl('https://app.example.com/webhooks//products//create'),
      'https://app.example.com/webhooks/products/create'
    );
  });

  void test('păstrează schema și hostul', () => {
    const out = normalizeCallbackUrl('https://cdn.example.com/a/b');
    assert.ok(out.startsWith('https://cdn.example.com/'));
  });
});

void describe('topicToEnum / enumToTopic', () => {
  void test('topicToEnum: slash-uri → underscore', () => {
    assert.strictEqual(topicToEnum('products/create'), 'PRODUCTS_CREATE');
    assert.strictEqual(topicToEnum('bulk_operations/finish'), 'BULK_OPERATIONS_FINISH');
  });

  void test('enumToTopic: mapare inversă pentru topicuri din REQUIRED_TOPICS', () => {
    assert.strictEqual(enumToTopic('PRODUCTS_CREATE'), 'products/create');
    assert.strictEqual(enumToTopic('products/create'), 'products/create');
  });
});
