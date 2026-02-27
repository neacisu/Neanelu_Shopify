import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BudgetAlertsPanel } from './BudgetAlertsPanel';

describe('BudgetAlertsPanel', () => {
  it('renders budget status and actions', () => {
    render(
      <BudgetAlertsPanel
        budget={{
          daily: 100,
          used: 50,
          percentage: 0.5,
          status: 'ok',
          warningThreshold: 0.8,
          criticalThreshold: 1,
        }}
      />
    );

    expect(screen.getByText('Buget in parametri')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pauzează coada/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reia coada/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pauzează toate cozile/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reia toate cozile/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Editează bugete/ })).toBeTruthy();
  });
});
