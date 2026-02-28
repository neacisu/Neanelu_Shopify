import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createSecondaryPool } from '../db.js';

void describe('createSecondaryPool', () => {
  void it('creates a secondary pool handle with stable API', async () => {
    const handle = createSecondaryPool({
      name: 'secondary-test',
      connectionString: 'postgresql://user:pass@127.0.0.1:5432/test',
      maxConnections: 1,
    });

    assert.ok(handle.pool);
    assert.strictEqual(typeof handle.rotate, 'function');
    assert.strictEqual(typeof handle.close, 'function');
    assert.strictEqual(typeof handle.getCurrentConnectionString, 'function');
    assert.strictEqual(
      handle.getCurrentConnectionString(),
      'postgresql://user:pass@127.0.0.1:5432/test'
    );

    await handle.close();
  });
});
