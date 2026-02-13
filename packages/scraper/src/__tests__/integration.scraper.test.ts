import { describe, expect, it, vi } from 'vitest';

import { scrapeProductPage } from '../scrapers/generic.js';

describe('scraper integration fixtures', () => {
  it('covers cheerio fast path and dedup callback', async () => {
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

    const result = await scrapeProductPage('https://fixtures.example.com/item', {
      redis: redis as never,
      userAgent: 'NeaneluPIM/1.0',
      timeoutMs: 5000,
      rateLimitPerDomain: 1,
      robotsCacheTtlSeconds: 86400,
      maxConcurrentPages: 1,
      staticHtml:
        '<html><script type="application/ld+json">{"@type":"Product","name":"Fixture"}</script></html>',
      isKnownHash: () => Promise.resolve(false),
    });
    expect(result.status).toBe('success');
  });

  it('covers robots.txt blocked flow', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue('User-agent: *\nDisallow: /'),
      set: vi.fn().mockResolvedValue('OK'),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      multi: vi.fn().mockReturnValue({
        zadd: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    };

    const result = await scrapeProductPage('https://blocked.example.com/item', {
      redis: redis as never,
      userAgent: 'NeaneluPIM/1.0',
      timeoutMs: 5000,
      rateLimitPerDomain: 1,
      robotsCacheTtlSeconds: 86400,
      maxConcurrentPages: 1,
      staticHtml: '<html><body>no jsonld</body></html>',
    });

    expect(result.status).toBe('robots_blocked');
  });

  it('covers content-hash dedup flow', async () => {
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

    const result = await scrapeProductPage('https://fixtures.example.com/dedup', {
      redis: redis as never,
      userAgent: 'NeaneluPIM/1.0',
      timeoutMs: 5000,
      rateLimitPerDomain: 1,
      robotsCacheTtlSeconds: 86400,
      maxConcurrentPages: 1,
      staticHtml:
        '<html><script type="application/ld+json">{"@type":"Product","name":"Fixture"}</script></html>',
      isKnownHash: () => Promise.resolve(true),
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('deduped');
    }
  });
});
