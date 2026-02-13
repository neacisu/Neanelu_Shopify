import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardSkeleton } from '../DashboardSkeleton';

describe('DashboardSkeleton', () => {
  it('renders loading status container', () => {
    render(<DashboardSkeleton rows={1} columns={2} variant="kpi" />);
    expect(screen.getByLabelText('Loading dashboard')).toBeTruthy();
  });

  it('renders chart and table variants', () => {
    const { container, rerender } = render(
      <DashboardSkeleton rows={1} columns={4} variant="chart" />
    );
    expect(container.querySelector('.h-56')).toBeTruthy();
    expect(container.querySelector('.lg\\:grid-cols-4')).toBeTruthy();

    rerender(<DashboardSkeleton rows={1} columns={3} variant="table" />);
    expect(container.querySelector('.h-44')).toBeTruthy();
  });
});
