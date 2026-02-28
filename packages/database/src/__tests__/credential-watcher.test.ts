import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseAllSecrets } from '../credential-watcher.js';

void describe('parseAllSecrets', () => {
  void it('parses env format with comments and quoted values', () => {
    const parsed = parseAllSecrets(`
# comment
DATABASE_URL="postgresql://user:pass@pgbouncer:6432/db"
REDIS_URL=redis://user:pass@redis:6379/0
REDIS_PREFIX='neanelu:'
SHOPIFY_API_KEY=test_key
`);

    assert.strictEqual(parsed['DATABASE_URL'], 'postgresql://user:pass@pgbouncer:6432/db');
    assert.strictEqual(parsed['REDIS_URL'], 'redis://user:pass@redis:6379/0');
    assert.strictEqual(parsed['REDIS_PREFIX'], 'neanelu:');
    assert.strictEqual(parsed['SHOPIFY_API_KEY'], 'test_key');
  });
});
