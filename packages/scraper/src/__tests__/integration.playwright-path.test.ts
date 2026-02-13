import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/page-factory.js', () => ({
  configureNewPage: vi.fn(() =>
    Promise.resolve({
      goto: vi.fn(() => Promise.resolve(undefined)),
      content: vi.fn(() =>
        Promise.resolve(
          '<html><script type="application/ld+json">{"@type":"Product","name":"Playwright Fixture"}</script></html>'
        )
      ),
      context: vi.fn(() => ({
        close: vi.fn(() => Promise.resolve(undefined)),
      })),
      close: vi.fn(() => Promise.resolve(undefined)),
    })
  ),
}));

vi.mock('../browser/browser-manager.js', () => ({
  releasePage: vi.fn(() => Promise.resolve(undefined)),
}));

describe('playwright path integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses playwright path when cheerio fast path is empty', async () => {
    const { scrapeProductPage } = await import('../scrapers/generic.js');

    const redis = {
      get: vi.fn().mockResolvedValue(''),
      set: vi.fn().mockResolvedValue('OK'),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      multi: vi.fn().mockReturnValue({
        zadd: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await scrapeProductPage('https://playwright.example.com/item', {
      redis: redis as never,
      userAgent: 'NeaneluPIM/1.0',
      timeoutMs: 5000,
      rateLimitPerDomain: 1,
      robotsCacheTtlSeconds: 86400,
      maxConcurrentPages: 1,
      staticHtml: '<html><body>no-json-ld-here</body></html>',
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.method).toBe('playwright');
      expect(result.jsonLd.length).toBeGreaterThan(0);
    }
  });
});
