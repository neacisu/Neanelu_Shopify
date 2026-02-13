import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/serper-rate-limiter.js', () => ({
  getCachedResult: vi.fn(),
  setCachedResult: vi.fn(),
  getSerperRateLimiter: () => ({ acquire: vi.fn() }),
}));

vi.mock('../services/serper-cost-tracker.js', () => ({
  checkDailyBudget: vi.fn(),
  trackSerperCost: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {},
}));

vi.mock('../repositories/similarity-matches.js', () => ({
  hasEnoughConfirmedMatches: vi.fn(),
}));

vi.mock('../services/raw-harvest-storage.js', () => ({
  storeRawHarvest: vi.fn(),
}));

import { searchProductByGTIN } from '../services/serper-search.js';
import { getCachedResult, setCachedResult } from '../services/serper-rate-limiter.js';
import { checkDailyBudget, trackSerperCost } from '../services/serper-cost-tracker.js';
import { hasEnoughConfirmedMatches } from '../repositories/similarity-matches.js';
import { storeRawHarvest } from '../services/raw-harvest-storage.js';

describe('Serper Search Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    process.env['SERPER_API_KEY'] = 'test-key';
  });

  it('returnează min. 3 rezultate pentru GTIN', async () => {
    vi.mocked(hasEnoughConfirmedMatches).mockResolvedValue(false);
    vi.mocked(getCachedResult).mockResolvedValue(null);
    vi.mocked(checkDailyBudget).mockResolvedValue({
      used: 0,
      limit: 1000,
      remaining: 1000,
      percentUsed: 0,
      exceeded: false,
      alertTriggered: false,
    });
    vi.mocked(storeRawHarvest).mockResolvedValue('harvest-id');
    vi.mocked(trackSerperCost).mockResolvedValue();

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => ({
        searchParameters: { q: '5941234567890', type: 'search' },
        organic: [
          { title: 'Product 1', link: 'https://example.com/1', position: 1 },
          { title: 'Product 2', link: 'https://example.com/2', position: 2 },
          { title: 'Product 3', link: 'https://example.com/3', position: 3 },
          { title: 'Product 4', link: 'https://example.com/4', position: 4 },
        ],
      }),
    } as unknown as Response);

    const results = await searchProductByGTIN('5941234567890');
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('nu caută dacă există 3+ matches confirmed', async () => {
    vi.mocked(hasEnoughConfirmedMatches).mockResolvedValue(true);

    const results = await searchProductByGTIN('5941234567890', 'product-id');
    expect(results).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('propagă shopId în tracking-ul de cost când este disponibil', async () => {
    vi.mocked(hasEnoughConfirmedMatches).mockResolvedValue(false);
    vi.mocked(getCachedResult).mockResolvedValue(null);
    vi.mocked(storeRawHarvest).mockResolvedValue('harvest-id');
    vi.mocked(trackSerperCost).mockResolvedValue();

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => ({
        searchParameters: { q: '5941234567890', type: 'search' },
        organic: [{ title: 'Product 1', link: 'https://example.com/1', position: 1 }],
      }),
    } as unknown as Response);

    await searchProductByGTIN('5941234567890', 'product-id', 'shop-1');
    expect(trackSerperCost).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 'shop-1',
      })
    );
  });

  it('returnează rezultatele din cache când există', async () => {
    vi.mocked(hasEnoughConfirmedMatches).mockResolvedValue(false);
    vi.mocked(checkDailyBudget).mockResolvedValue({
      used: 0,
      limit: 1000,
      remaining: 1000,
      percentUsed: 0,
      exceeded: false,
      alertTriggered: false,
    });
    vi.mocked(getCachedResult).mockResolvedValue([
      {
        title: 'Cached',
        url: 'https://example.com/cached',
        position: 1,
        source: 'organic',
      },
    ]);

    const results = await searchProductByGTIN('5941234567890');
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Cached');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(setCachedResult).not.toHaveBeenCalled();
  });
});
