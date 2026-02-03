import { describe, expect, it } from 'vitest';

import { createMatch } from '../repositories/similarity-matches.js';

describe('Similarity Matches Repository', () => {
  it('refuză scoruri sub 0.90', async () => {
    await expect(
      createMatch({
        sourceUrl: 'https://example.com/p1',
        similarityScore: 0.5,
        matchMethod: 'title_fuzzy',
      })
    ).rejects.toThrow('Similarity score below minimum threshold.');
  });
});
