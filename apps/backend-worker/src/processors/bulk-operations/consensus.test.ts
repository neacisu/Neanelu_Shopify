import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveConflict } from './consensus.js';

void describe('bulk: consensus resolveConflict', () => {
  void it('prefers higher source priority', () => {
    const r = resolveConflict('brand', [
      {
        value: 'ACME',
        sourceType: 'bulk_import',
        confidence: 1.0,
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      {
        value: 'ACME OFFICIAL',
        sourceType: 'brand',
        confidence: 0.8,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      },
    ]);

    assert.equal(r.value, 'ACME OFFICIAL');
  });

  void it('breaks ties by confidence then timestamp', () => {
    const r1 = resolveConflict('title', [
      {
        value: 'A',
        sourceType: 'bulk_import',
        confidence: 0.8,
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      {
        value: 'B',
        sourceType: 'bulk_import',
        confidence: 0.9,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      },
    ]);
    assert.equal(r1.value, 'B');

    const r2 = resolveConflict('title', [
      {
        value: 'A',
        sourceType: 'bulk_import',
        confidence: 0.9,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      },
      {
        value: 'B',
        sourceType: 'bulk_import',
        confidence: 0.9,
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
    ]);
    assert.equal(r2.value, 'B');
  });

  void it('flags needsReview when high-confidence alternates disagree', () => {
    const r = resolveConflict('gtin', [
      {
        value: '123',
        sourceType: 'brand',
        confidence: 0.95,
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      {
        value: '124',
        sourceType: 'curated',
        confidence: 0.9,
        timestamp: new Date('2025-01-02T00:00:00Z'),
      },
    ]);

    assert.equal(r.needsReview, true);
  });
});
