import { describe, expect, it, vi } from 'vitest';

import { scrapeProductPage } from '../scrapers/generic.js';

describe('scrapeProductPage', () => {
  it('returns cheerio success when static html has product json-ld', async () => {
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

    const result = await scrapeProductPage('https://example.com/p/1', {
      redis: redis as never,
      userAgent: 'NeaneluPIM/1.0',
      timeoutMs: 5000,
      rateLimitPerDomain: 1,
      robotsCacheTtlSeconds: 86400,
      maxConcurrentPages: 1,
      staticHtml: '<script type="application/ld+json">{"@type":"Product","name":"Demo"}</script>',
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.method).toBe('cheerio');
    }
  });
});
