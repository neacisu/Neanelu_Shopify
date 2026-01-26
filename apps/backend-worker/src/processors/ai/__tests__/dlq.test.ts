import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { moveToEmbeddingDlq } from '../dlq.js';

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

void describe('embedding dlq', () => {
  void it('no-ops when entries are empty', async () => {
    await moveToEmbeddingDlq({
      entries: [],
      logger,
    });
    assert.ok(true);
  });
});
