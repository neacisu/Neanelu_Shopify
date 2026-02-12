import { describe, expect, it, vi } from 'vitest';

import { BudgetExceededError, enforceBudget } from '../services/budget-guard.js';

vi.mock('../services/cost-tracker.js', () => ({
  checkBudget: vi.fn(),
}));

import { checkBudget } from '../services/cost-tracker.js';

describe('budget-guard', () => {
  it('throws BudgetExceededError when exceeded', async () => {
    vi.mocked(checkBudget).mockResolvedValueOnce({
      provider: 'serper',
      primary: { unit: 'requests', used: 1001, limit: 1000, remaining: 0, ratio: 1.001 },
      alertThreshold: 0.8,
      exceeded: true,
      alertTriggered: true,
    });

    await expect(enforceBudget({ provider: 'serper', shopId: 'shop-1' })).rejects.toBeInstanceOf(
      BudgetExceededError
    );
  });

  it('calls warning hook when threshold reached', async () => {
    const onWarning = vi.fn();
    vi.mocked(checkBudget).mockResolvedValueOnce({
      provider: 'xai',
      primary: { unit: 'dollars', used: 80, limit: 100, remaining: 20, ratio: 0.8 },
      alertThreshold: 0.8,
      exceeded: false,
      alertTriggered: true,
    });

    await enforceBudget({
      provider: 'xai',
      shopId: 'shop-1',
      hooks: { onWarning },
    });

    expect(onWarning).toHaveBeenCalledTimes(1);
  });
});
