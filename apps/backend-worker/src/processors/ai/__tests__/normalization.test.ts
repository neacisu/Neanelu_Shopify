import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSearchQuery } from '../normalization.js';

void describe('normalizeSearchQuery', () => {
  void it('trims, collapses whitespace, and lowercases', () => {
    const normalized = normalizeSearchQuery('  iPhone   Case  ');
    assert.equal(normalized, 'iphone case');
  });
});
