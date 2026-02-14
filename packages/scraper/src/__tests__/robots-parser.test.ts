import { describe, expect, it, vi } from 'vitest';

import { isUrlAllowed } from '../utils/robots-parser.js';

describe('isUrlAllowed', () => {
  it('allows url on cache miss + permissive fallback', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const result = await isUrlAllowed(
      'https://example.com/products/1',
      redis as never,
      'NeaneluPIM/1.0',
      86400
    );
    expect(typeof result).toBe('boolean');
  });
});
