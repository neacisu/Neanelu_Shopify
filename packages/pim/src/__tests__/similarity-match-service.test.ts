import { describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/similarity-matches.js', () => ({
  createMatch: vi.fn(() => Promise.resolve({ id: 'match-id' })),
}));

import { SimilarityMatchService } from '../services/similarity-match-service.js';
import { createMatch } from '../repositories/similarity-matches.js';

describe('SimilarityMatchService', () => {
  it('determină corect triajul pe praguri', () => {
    const service = new SimilarityMatchService();
    expect(service.determineTriageAction(0.99)).toBe('auto_approve');
    expect(service.determineTriageAction(0.95)).toBe('ai_audit');
    expect(service.determineTriageAction(0.92)).toBe('hitl_required');
    expect(service.determineTriageAction(0.5)).toBe('rejected');
  });

  it('calculează scor mare pentru GTIN match', () => {
    const service = new SimilarityMatchService();
    const result = service.calculateSimilarityScore(
      {
        id: 'p1',
        title: 'Pompa submersibila 750W',
        brand: 'AquaPro',
        gtin: '5941234567890',
        price: 199,
      },
      {
        title: 'Pompa submersibila 750W AquaPro',
        url: 'https://example.com/p1',
        position: 1,
        source: 'organic',
        structuredData: {
          gtin: '5941234567890',
          brand: 'AquaPro',
          price: '199.00',
        },
      }
    );

    expect(result.score).toBeGreaterThan(0.9);
    expect(result.breakdown.gtinMatch).toBe(1);
  });

  it('creează match cu auto-approve pentru scor >= 0.98', async () => {
    const service = new SimilarityMatchService();
    const result = await service.createMatchWithTriage({
      productId: 'prod-1',
      sourceUrl: 'https://example.com/1',
      sourceTitle: 'Title',
      similarityScore: 0.99,
      matchMethod: 'gtin_exact',
    });

    expect(result.success).toBe(true);
    expect(result.triageDecision).toBe('auto_approve');
    expect(vi.mocked(createMatch)).toHaveBeenCalled();
  });
});
