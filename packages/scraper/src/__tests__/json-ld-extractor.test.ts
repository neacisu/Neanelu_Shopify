import { describe, expect, it } from 'vitest';

import { extractJsonLd } from '../utils/json-ld-extractor.js';

describe('extractJsonLd', () => {
  it('extracts product json-ld blocks', () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Demo"}
      </script>
    `;
    const items = extractJsonLd(html);
    expect(items).toHaveLength(1);
    expect(items[0]?.['name']).toBe('Demo');
  });
});
