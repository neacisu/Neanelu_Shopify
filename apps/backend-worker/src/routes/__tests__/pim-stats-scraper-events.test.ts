import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchScraperEventsSince } from '../pim-stats.js';

void describe('pim-stats scraper events tenant filtering', () => {
  void it('queries scraper events scoped by shop_id', async () => {
    let capturedSql = '';
    let capturedValues: unknown[] = [];

    const rows = await fetchScraperEventsSince({
      client: {
        query: <T>(sql: string, values: unknown[]) => {
          capturedSql = sql;
          capturedValues = values;
          return Promise.resolve({ rows: [] as T[] });
        },
      },
      shopId: 'shop-1',
      lastSeenAt: '2026-02-13T00:00:00.000Z',
    });

    assert.deepEqual(rows, []);
    assert.match(capturedSql, /FROM scraper_runs/i);
    assert.match(capturedSql, /WHERE shop_id = \$1/i);
    assert.deepEqual(capturedValues, ['shop-1', '2026-02-13T00:00:00.000Z']);
  });
});
