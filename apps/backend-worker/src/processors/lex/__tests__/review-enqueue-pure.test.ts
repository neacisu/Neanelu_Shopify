import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  REVIEW_ENQUEUE_MAX_PAGES,
  REVIEW_ENQUEUE_PAGE_SIZE,
  REVIEW_ENQUEUE_UUID_ZERO,
  chunkLexReviewEnqueueIds,
} from '../review-enqueue-pure.js';

void describe('review-enqueue-pure constants', () => {
  void test('page size and cap match f3-27 expectations', () => {
    assert.strictEqual(REVIEW_ENQUEUE_PAGE_SIZE, 500);
    assert.strictEqual(REVIEW_ENQUEUE_MAX_PAGES, 500);
  });

  void test('uuid zero is valid lowercase nil uuid', () => {
    assert.strictEqual(REVIEW_ENQUEUE_UUID_ZERO, '00000000-0000-0000-0000-000000000000');
  });
});

void describe('chunkLexReviewEnqueueIds', () => {
  void test('returns empty for empty input', () => {
    assert.deepStrictEqual(chunkLexReviewEnqueueIds([], 500), []);
  });

  void test('splits into full and partial last chunk', () => {
    const ids = Array.from({ length: 501 }, (_, i) => String(i));
    const chunks = chunkLexReviewEnqueueIds(ids, 500);
    assert.strictEqual(chunks.length, 2);
    const [first, second] = chunks;
    assert.ok(first);
    assert.ok(second);
    assert.strictEqual(first.length, 500);
    assert.strictEqual(second.length, 1);
  });

  void test('exact multiple produces only full chunks', () => {
    const ids = ['a', 'b', 'c'];
    const chunks = chunkLexReviewEnqueueIds(ids, 1);
    assert.strictEqual(chunks.length, 3);
    assert.deepStrictEqual(
      chunks.map((c) => c[0]),
      ['a', 'b', 'c']
    );
  });
});
