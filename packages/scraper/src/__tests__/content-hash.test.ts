import { describe, expect, it } from 'vitest';

import { hashHtmlContent } from '../utils/content-hash.js';

describe('hashHtmlContent', () => {
  it('returns deterministic sha256 hash', () => {
    const html = '<html><body>Hello</body></html>';
    const a = hashHtmlContent(html);
    const b = hashHtmlContent(html);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
