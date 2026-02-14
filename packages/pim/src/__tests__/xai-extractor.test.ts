import { describe, expect, it, vi } from 'vitest';

import { XaiExtractorService } from '../services/xai-extractor.js';

vi.mock('../services/xai-rate-limiter.js', () => ({
  acquireXaiRateLimit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/xai-cost-tracker.js', () => ({
  checkXaiDailyBudget: vi.fn(() => Promise.resolve({ exceeded: false })),
  trackXaiCost: vi.fn(() => Promise.resolve()),
}));

vi.mock('../services/budget-guard.js', () => ({
  enforceBudget: vi.fn(() => Promise.resolve()),
}));

const credentials = {
  apiKey: 'xai-test',
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-4-1-fast-non-reasoning',
  temperature: 0.1,
  maxTokensPerRequest: 2000,
  rateLimitPerMinute: 60,
  dailyBudget: 1000,
  budgetAlertThreshold: 0.8,
};

describe('XaiExtractorService', () => {
  it('returneaza succes cand confidence >= 0.8', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Produs test',
                specifications: [],
                images: [],
                confidence: { overall: 0.9, fieldsUncertain: [] },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    });
    globalThis.fetch = fetchMock;

    const service = new XaiExtractorService();
    const result = await service.extractProductFromHTML({
      html: '<html>Produs</html>',
      sourceUrl: 'https://example.com/product',
      shopId: 'shop-1',
      credentials,
    });

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Produs test');
  });

  it('returneaza esec cand confidence < 0.8', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Produs test',
                specifications: [],
                images: [],
                confidence: { overall: 0.5, fieldsUncertain: ['title'] },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
    });
    globalThis.fetch = fetchMock;

    const service = new XaiExtractorService();
    const result = await service.extractProductFromHTML({
      html: '<html>Produs</html>',
      sourceUrl: 'https://example.com/product',
      shopId: 'shop-1',
      credentials,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Confidence');
  });

  it('returneaza esec cand payload JSON este invalid', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => ({
        choices: [
          {
            message: {
              content: '{not-json}',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });
    globalThis.fetch = fetchMock;

    const service = new XaiExtractorService();
    const result = await service.extractProductFromHTML({
      html: '<html>Produs</html>',
      sourceUrl: 'https://example.com/product',
      shopId: 'shop-1',
      credentials,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('marcheaza GTIN invalid ca nesigur si scade confidence', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Produs test',
                gtin: '4006381333932', // checksum invalid
                specifications: [],
                images: [],
                confidence: { overall: 0.9, fieldsUncertain: [] },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    });
    globalThis.fetch = fetchMock;

    const service = new XaiExtractorService();
    const result = await service.extractProductFromHTML({
      html: '<html>Produs</html>',
      sourceUrl: 'https://example.com/product',
      shopId: 'shop-1',
      credentials,
    });

    expect(result.gtinValidation?.valid).toBe(false);
    expect(result.data?.confidence.fieldsUncertain).toContain('gtin');
    // Confidence should be reduced under threshold -> extraction is treated as failure.
    expect(result.success).toBe(false);
  });
});
