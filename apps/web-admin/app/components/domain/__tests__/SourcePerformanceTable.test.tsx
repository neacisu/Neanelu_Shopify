import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SourcePerformanceTable } from '../SourcePerformanceTable';

describe('SourcePerformanceTable', () => {
  const rows = [
    {
      sourceName: 'Alpha',
      sourceType: 'api',
      totalHarvests: 10,
      successfulHarvests: 9,
      pendingHarvests: 0,
      failedHarvests: 1,
      successRate: 90,
      trustScore: 0.95,
      isActive: true,
      lastHarvestAt: '2026-02-10T10:00:00Z',
    },
    {
      sourceName: 'Beta',
      sourceType: 'feed',
      totalHarvests: 10,
      successfulHarvests: 6,
      pendingHarvests: 1,
      failedHarvests: 3,
      successRate: 60,
      trustScore: 0.6,
      isActive: false,
      lastHarvestAt: '2026-02-10T11:00:00Z',
    },
  ] as const;

  it('sorts rows by success rate when header is clicked', () => {
    render(<SourcePerformanceTable rows={rows} />);

    let bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows[0]?.textContent).toContain('Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by success rate' }));

    bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows[0]?.textContent).toContain('Beta');
  });

  it('sorts rows by trust score and shows empty state', () => {
    const { rerender } = render(<SourcePerformanceTable rows={rows} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by trust score' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort by trust score' }));
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows[0]?.textContent).toContain('Beta');

    rerender(<SourcePerformanceTable rows={[]} />);
    expect(screen.getByText('No source performance data yet.')).toBeTruthy();
  });
});
