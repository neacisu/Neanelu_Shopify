import { describe, it } from 'node:test';
import assert from 'node:assert';

import { registerWorkerRecreator, recreateAllWorkers } from '../redis-manager.js';

void describe('redis-manager worker recreators', () => {
  void it('invokes registered worker recreator callbacks', async () => {
    let called = 0;
    registerWorkerRecreator('test-worker', (_redisUrl: string) => {
      called += 1;
      return Promise.resolve();
    });

    await recreateAllWorkers('redis://rotated:secret@localhost:6379/0');
    assert.strictEqual(called, 1);
  });
});
