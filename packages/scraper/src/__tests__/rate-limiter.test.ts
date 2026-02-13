import { describe, expect, it, vi } from 'vitest';

import { waitForRateLimit } from '../utils/rate-limiter.js';

describe('waitForRateLimit', () => {
  it('adds request timestamp in redis set', async () => {
    const redis = {
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      multi: vi.fn().mockReturnValue({
        zadd: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    };

    await waitForRateLimit('https://example.com/p/1', redis as never, 1);
    expect(redis.zcard).toHaveBeenCalled();
  });
});
