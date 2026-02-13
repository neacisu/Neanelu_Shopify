import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CostBreakdownChart } from './CostBreakdownChart';

describe('CostBreakdownChart', () => {
  it('renders empty state when there is no data', () => {
    render(<CostBreakdownChart data={[]} />);
    expect(screen.getByText('Distribuție zilnica costuri')).toBeTruthy();
    expect(screen.getByText('Nu exista date pentru perioada selectata.')).toBeTruthy();
  });
});
