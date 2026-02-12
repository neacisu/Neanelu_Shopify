import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db.js', () => ({
  getDbPool: () => ({
    query: queryMock,
  }),
}));

import { checkBudget, trackCost } from '../services/cost-tracker.js';

describe('cost-tracker', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('persists api usage log for serper', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await trackCost({
      provider: 'serper',
      operation: 'search',
      endpoint: '/search',
      requestCount: 1,
      estimatedCost: 0.001,
      httpStatus: 200,
      responseTimeMs: 300,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('INSERT INTO api_usage_log');
  });

  it('computes openai dual budget status', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            openai_daily_budget: '10.00',
            openai_budget_alert_threshold: '0.80',
            openai_items_daily_budget: 100000,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ used_cost: '8.25', used_items: '90000' }],
      });

    const status = await checkBudget('openai', 'shop-1');
    expect(status.provider).toBe('openai');
    expect(status.primary.ratio).toBeCloseTo(0.825, 3);
    expect(status.secondary?.ratio).toBeCloseTo(0.9, 3);
    expect(status.alertTriggered).toBe(true);
  });
});
