import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recoverStaleScraperQueueItems } from '../extraction.worker.js';

void describe('scraper queue stale processing recovery', () => {
  void it('resets stale processing rows back to pending', async () => {
    let capturedSql = '';
    await recoverStaleScraperQueueItems({
      query: (sql: string) => {
        capturedSql = sql;
        return Promise.resolve({});
      },
    });

    assert.match(capturedSql, /UPDATE scraper_queue/i);
    assert.match(capturedSql, /SET status = 'pending'/i);
    assert.match(capturedSql, /WHERE status = 'processing'/i);
    assert.match(capturedSql, /last_attempt_at < now\(\) - interval '10 minutes'/i);
  });
});
