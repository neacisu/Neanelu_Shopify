import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnrichmentStatsCards } from './EnrichmentStatsCards';

describe('EnrichmentStatsCards', () => {
  it('renders stats values', () => {
    render(
      <EnrichmentStatsCards
        stats={{
          pending: 10,
          inProgress: 5,
          completedToday: 7,
          successRate: 0.75,
          trendsData: { pending: [1, 2, 3], completed: [2, 4, 6] },
        }}
      />
    );

    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Completed today')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });
});
