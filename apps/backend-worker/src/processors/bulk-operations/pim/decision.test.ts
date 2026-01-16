import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decidePimTarget } from './decision.js';

void describe('pim: decidePimTarget', () => {
  void it('returns existing product when channel mapping exists', () => {
    const d = decidePimTarget({
      existingChannelMappingProductId: 'p_mapped',
      gtinExactMatchProductId: 'p_gtin',
      semanticMatches: [{ productId: 'p_sem', similarity: 0.99 }],
      thresholds: { highConfidence: 0.95, suspicious: 0.85 },
    });

    assert.equal(d.kind, 'use_existing');
    assert.equal(d.productId, 'p_mapped');
    assert.equal(d.needsReview, false);
  });

  void it('prefers GTIN exact match', () => {
    const d = decidePimTarget({
      existingChannelMappingProductId: null,
      gtinExactMatchProductId: 'p1',
      semanticMatches: [{ productId: 'p2', similarity: 0.99 }],
      thresholds: { highConfidence: 0.95, suspicious: 0.85 },
    });

    assert.equal(d.kind, 'use_existing');
    assert.equal(d.productId, 'p1');
  });

  void it('uses semantic match for high confidence', () => {
    const d = decidePimTarget({
      existingChannelMappingProductId: null,
      gtinExactMatchProductId: null,
      semanticMatches: [{ productId: 'p2', similarity: 0.951 }],
      thresholds: { highConfidence: 0.95, suspicious: 0.85 },
    });

    assert.equal(d.kind, 'use_existing');
    assert.equal(d.productId, 'p2');
    assert.equal(d.needsReview, false);
  });

  void it('creates new but flags needsReview in suspicious zone', () => {
    const d = decidePimTarget({
      existingChannelMappingProductId: null,
      gtinExactMatchProductId: null,
      semanticMatches: [{ productId: 'p2', similarity: 0.91 }],
      thresholds: { highConfidence: 0.95, suspicious: 0.85 },
    });

    assert.equal(d.kind, 'create_new');
    assert.equal(d.needsReview, true);
  });
});
