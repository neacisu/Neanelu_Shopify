import { describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db.js', () => ({
  getDbPool: () => ({
    query: queryMock,
  }),
}));

import { createExtractionSession } from '../repositories/extraction-sessions.js';

describe('extraction-sessions repository', () => {
  it('creeaza sesiune de extractie', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'session-1',
          harvestId: 'harvest-1',
          agentVersion: 'xai-extractor-v1.0',
          modelName: 'grok-4-1-fast-non-reasoning',
          extractedSpecs: { title: 'Produs' },
          groundingSnippets: null,
          confidenceScore: '0.9',
          fieldConfidences: null,
          tokensUsed: 150,
          latencyMs: 1200,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const result = await createExtractionSession({
      harvestId: 'harvest-1',
      agentVersion: 'xai-extractor-v1.0',
      modelName: 'grok-4-1-fast-non-reasoning',
      extractedSpecs: { title: 'Produs' },
      confidenceScore: 0.9,
      tokensUsed: 150,
      latencyMs: 1200,
    });

    expect(result.id).toBe('session-1');
    expect(result.agentVersion).toBe('xai-extractor-v1.0');
  });
});
