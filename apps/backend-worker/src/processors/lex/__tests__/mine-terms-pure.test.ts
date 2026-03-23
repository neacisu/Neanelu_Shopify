import assert from 'node:assert';
import { describe, test } from 'node:test';

import type { LexToken } from '../pipeline-utils.js';
import { buildLexTermMiningWindows, shouldSkipLexMiningToken } from '../mine-terms-pure.js';

function lexToken(
  overrides: Partial<LexToken> & Pick<LexToken, 'raw' | 'normalized' | 'start' | 'end'>
): LexToken {
  return {
    tokenIndex: 0,
    ...overrides,
  };
}

void describe('shouldSkipLexMiningToken', () => {
  void test('skips when overlapping protected span', () => {
    const token = lexToken({ raw: 'x', normalized: 'x', start: 5, end: 6, tokenIndex: 0 });
    assert.strictEqual(shouldSkipLexMiningToken(token, [{ start: 0, end: 10 }], new Set()), true);
  });

  void test('skips stopword', () => {
    const token = lexToken({ raw: 'și', normalized: 'si', start: 0, end: 2, tokenIndex: 0 });
    assert.strictEqual(shouldSkipLexMiningToken(token, [], new Set(['si'])), true);
  });

  void test('skips short normalized', () => {
    const token = lexToken({ raw: 'a', normalized: 'a', start: 0, end: 1, tokenIndex: 0 });
    assert.strictEqual(shouldSkipLexMiningToken(token, [], new Set()), true);
  });

  void test('skips pure digits', () => {
    const token = lexToken({ raw: '42', normalized: '42', start: 0, end: 2, tokenIndex: 0 });
    assert.strictEqual(shouldSkipLexMiningToken(token, [], new Set()), true);
  });

  void test('allows normal token', () => {
    const token = lexToken({
      raw: 'vitamina',
      normalized: 'vitamina',
      start: 0,
      end: 8,
      tokenIndex: 0,
    });
    assert.strictEqual(shouldSkipLexMiningToken(token, [], new Set()), false);
  });
});

void describe('buildLexTermMiningWindows', () => {
  void test('returns unigram only when next token is stopword', () => {
    const a = lexToken({
      raw: 'vitamina',
      normalized: 'vitamina',
      start: 0,
      end: 8,
      tokenIndex: 0,
    });
    const b = lexToken({ raw: 'c', normalized: 'c', start: 9, end: 10, tokenIndex: 1 });
    const tokens = [a, b];
    const w = buildLexTermMiningWindows(tokens, 0, [], new Set(['c']));
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0]!.endIndex, 0);
  });

  void test('adds bigram when next token is allowed', () => {
    const a = lexToken({ raw: 'acid', normalized: 'acid', start: 0, end: 4, tokenIndex: 0 });
    const b = lexToken({ raw: 'folic', normalized: 'folic', start: 5, end: 10, tokenIndex: 1 });
    const tokens = [a, b];
    const w = buildLexTermMiningWindows(tokens, 0, [], new Set());
    assert.strictEqual(w.length, 2);
    assert.strictEqual(w[1]!.raw, 'acid folic');
    assert.strictEqual(w[1]!.endIndex, 1);
  });

  void test('does not extend bigram when next token in protected span', () => {
    const a = lexToken({ raw: 'foo', normalized: 'foo', start: 0, end: 3, tokenIndex: 0 });
    const b = lexToken({ raw: 'bar', normalized: 'bar', start: 4, end: 7, tokenIndex: 1 });
    const tokens = [a, b];
    const w = buildLexTermMiningWindows(tokens, 0, [{ start: 4, end: 7 }], new Set());
    assert.strictEqual(w.length, 1);
  });
});
