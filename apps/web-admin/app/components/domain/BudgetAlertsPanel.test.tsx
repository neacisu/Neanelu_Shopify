import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BudgetAlertsPanel } from './BudgetAlertsPanel';

describe('BudgetAlertsPanel', () => {
  it('renders budget status and actions', () => {
    render(<BudgetAlertsPanel budget={{ daily: 100, used: 50, percentage: 0.5, status: 'ok' }} />);

    expect(screen.getByText('Budget healthy')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pause queue/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Increase budget/i })).toBeTruthy();
  });
});
