import { describe, expect, it } from 'vitest';

import { ShopPreferencesSchema } from '../shop-settings.js';

describe('ShopPreferencesSchema', () => {
  it('accepts valid preferences', () => {
    const result = ShopPreferencesSchema.safeParse({
      timezone: 'Europe/Bucharest',
      language: 'ro',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid timezone', () => {
    const result = ShopPreferencesSchema.safeParse({
      timezone: 'Invalid/Zone',
      language: 'en',
    });
    expect(result.success).toBe(false);
  });
});
