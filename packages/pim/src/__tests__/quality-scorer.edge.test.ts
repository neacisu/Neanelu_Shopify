import { describe, expect, it } from 'vitest';

import { calculateQualityScore, computeQualityBreakdown } from '../services/quality-scorer.js';
import type { AttributeVote } from '../types/consensus.js';

function makeVote(params: {
  attributeName: string;
  value: unknown;
  confidence?: number;
  trustScore?: number;
}): AttributeVote {
  return {
    attributeName: params.attributeName,
    value: params.value,
    sourceId: 'source-1',
    sourceName: 'Source One',
    trustScore: params.trustScore ?? 0.8,
    similarityScore: 1,
    matchId: 'match-1',
    extractedAt: new Date('2026-02-01T00:00:00Z'),
    ...(typeof params.confidence === 'number' ? { confidence: params.confidence } : {}),
  };
}

describe('quality-scorer edge cases (unit)', () => {
  it('treats missing requiredFields as completeness=1', () => {
    const breakdown = computeQualityBreakdown({
      consensusSpecs: {},
      attributeVotes: new Map(),
      requiredFields: [],
      sourceCount: 0,
    });

    expect(breakdown.completeness).toBe(1);
  });

  it('keeps consistency=1 when there are no votes', () => {
    const breakdown = computeQualityBreakdown({
      consensusSpecs: {},
      attributeVotes: new Map(),
      requiredFields: ['gtin', 'brand'],
      sourceCount: 0,
    });

    expect(breakdown.consistency).toBe(1);
    expect(breakdown.accuracy).toBe(0);
    expect(breakdown.sourceWeight).toBe(0);
  });

  it('does not count conflicts for string values differing only by case/whitespace', () => {
    const votes = new Map<string, AttributeVote[]>([
      [
        'color',
        [
          makeVote({ attributeName: 'color', value: 'Red', confidence: 0.9, trustScore: 0.8 }),
          makeVote({ attributeName: 'color', value: ' red ', confidence: 0.9, trustScore: 0.8 }),
        ],
      ],
    ]);

    const breakdown = computeQualityBreakdown({
      consensusSpecs: { color: 'red' },
      attributeVotes: votes,
      requiredFields: [],
      sourceCount: 2,
    });

    expect(breakdown.consistency).toBe(1);
  });

  it('clamps NaN/Infinity to 0..1', () => {
    const score = calculateQualityScore({
      completeness: Number.NaN,
      accuracy: Number.POSITIVE_INFINITY,
      consistency: -1,
      sourceWeight: 2,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
